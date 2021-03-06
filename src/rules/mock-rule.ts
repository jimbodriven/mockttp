/**
 * @module MockRule
 */

import uuid = require("uuid/v4");

import { deserialize, SerializationOptions } from '../util/serialization';
import { waitForCompletedRequest } from '../util/request-utils';

import { OngoingRequest, CompletedRequest, Response } from "../types";
import {
  MockRule as MockRuleInterface,
  RuleExplainable,
  RuleCompletionChecker,
  RequestHandler,
  RequestMatcher,
  MockRuleData
} from "./mock-rule-types";

import * as matching from "./matchers";
import * as handling from "./handlers";
import * as completion from "./completion-checkers";

export function serializeRuleData(data: MockRuleData, options?: SerializationOptions) {
    return {
        matchers: data.matchers.map(m => m.serialize(options)),
        handler: data.handler.serialize(options),
        completionChecker: data.completionChecker && data.completionChecker.serialize(options)
    }
};

export function deserializeRuleData(data: any, options?: SerializationOptions): MockRuleData {
    return { 
        matchers: data.matchers.map((m: any) =>
            deserialize(m, matching.MatcherDataLookup, options)
        ),
        handler: deserialize(data.handler, handling.HandlerDataLookup, options),
        completionChecker: data.completionChecker && deserialize(
            data.completionChecker,
            completion.CompletionCheckerDataLookup,
            options
        )
    };
}

export class MockRule implements MockRuleInterface {
    public matches: RequestMatcher;
    public isComplete?: RuleCompletionChecker;
    public handleRequest: RequestHandler;

    public id: string = uuid();
    public requests: Promise<CompletedRequest>[] = [];

    constructor({
        matchers,
        handler,
        completionChecker
    }: MockRuleData) {
        this.matches = matching.buildMatchers(matchers);
        this.handleRequest = this.recordRequests(handling.buildHandler(handler));
        this.isComplete = completion.buildCompletionChecker(completionChecker);
    }

    // Wrap the handler, to add the request to this.requests when it's done
    private recordRequests(handler: RequestHandler): RequestHandler {
        const thisRule = this;

        const recordRequest = <RequestHandler> function recordRequest(this: any, req: OngoingRequest, res: Response) {
            const handlerArgs = arguments;
            let completedAndRecordedPromise = (async (resolve, reject) => {
                // Start recording before the data starts piping, so we don't miss anything.                
                let buffer = req.body.asBuffer();

                await handler.apply(this, handlerArgs);

                return waitForCompletedRequest(req);
            })();
            
            // Requests are added to rule.requests as soon as they start being handled.
            thisRule.requests.push(completedAndRecordedPromise);

            return completedAndRecordedPromise.then(() => {});
        };

        recordRequest.explain = handler.explain;
        return recordRequest;
    }

    explain(): string {
        let explanation = `Match requests ${this.matches.explain.apply(this)}, ` +
        `and then ${this.handleRequest.explain.apply(this)}`;

        if (this.isComplete) {
            explanation += `, ${this.isComplete.explain.apply(this)}.`;
        } else {
            explanation += '.';
        }

        return explanation;
    }
}