/**
 * @module MockRuleData
 */

import * as _ from "lodash";

import { OngoingRequest, Method } from "../types";
import { RequestMatcher } from "./mock-rule-types";
import { MockRule } from "./mock-rule";
import { Serializable } from "../util/serialization";
import normalizeUrl from "../util/normalize-url";

export class WildcardMatcherData extends Serializable {
    readonly type: 'wildcard' = 'wildcard';

    buildMatcher() {
        return _.assign(
            () => true,
            { explain: () => 'for anything' }
        );
    }
}

export class MethodMatcherData extends Serializable {
    readonly type: 'method' = 'method';

    constructor(
        public method: Method
    ) {
        super();
    }
    
    buildMatcher() {
        let methodName = Method[this.method];

        return _.assign((request: OngoingRequest) =>
            request.method === methodName
        , { explain: () => `making ${methodName}s` });
    }
}

export class SimplePathMatcherData extends Serializable {
    readonly type: 'simple-path' = 'simple-path';

    constructor(
        public path: string
    ) {
        super();
    }

    buildMatcher() {
        let url = normalizeUrl(this.path);

        return _.assign((request: OngoingRequest) =>
            normalizeUrl(request.url) === url
        , { explain: () => `for ${this.path}` });
    }
}

export class RegexPathMatcherData extends Serializable {
    readonly type: 'regex-path' = 'regex-path';
    readonly regexString: string;

    constructor(regex: RegExp) {
        super();
        this.regexString = regex.source;
    }

    buildMatcher() {
        let url = new RegExp(this.regexString);

        return _.assign((request: OngoingRequest) =>
            url.test(normalizeUrl(request.url))
        , { explain: () => `for paths matching /${this.regexString}/` });
    }
}

export class HeaderMatcherData extends Serializable {
    readonly type: 'header' = 'header';

    constructor(
        public headers: { [key: string]: string },
    ) {
        super();
    }

    buildMatcher() {
        let lowerCasedHeaders = _.mapKeys(this.headers, (value: string, key: string) => key.toLowerCase());
        return _.assign(
            (request: OngoingRequest) => _.isMatch(request.headers, lowerCasedHeaders)
        , { explain: () => `with headers including ${JSON.stringify(this.headers)}` });
    }
}

export class FormDataMatcherData extends Serializable {
    readonly type: 'form-data' = 'form-data';

    constructor(
        public formData: { [key: string]: string }
    ) {
        super();
    }

    buildMatcher() {
        return _.assign(async (request: OngoingRequest) =>
            !!request.headers["content-type"] &&
            request.headers["content-type"].indexOf("application/x-www-form-urlencoded") !== -1 &&
            _.isMatch(await request.body.asFormData(), this.formData)
        , { explain: () => `with form data including ${JSON.stringify(this.formData)}` });
    }
}

export class RawBodyMatcherData extends Serializable {
    readonly type: 'raw-body' = 'raw-body';

    constructor(
        public content: string
    ) {
        super();
    }

    buildMatcher() {
        return _.assign(async (request: OngoingRequest) =>
            (await request.body.asText()) === this.content
        , { explain: () => `with body '${this.content}'` });
    }
}

export type MatcherData = (
    WildcardMatcherData |
    MethodMatcherData |
    SimplePathMatcherData |
    RegexPathMatcherData |
    HeaderMatcherData |
    FormDataMatcherData |
    RawBodyMatcherData
);

export const MatcherDataLookup = {
    'wildcard': WildcardMatcherData,
    'method': MethodMatcherData,
    'simple-path': SimplePathMatcherData,
    'regex-path': RegexPathMatcherData,
    'header': HeaderMatcherData,
    'form-data': FormDataMatcherData,
    'raw-body': RawBodyMatcherData
}

export function buildMatchers(matcherPartData: MatcherData[]): RequestMatcher {
    const matchers = matcherPartData.map(m => m.buildMatcher());

    return _.assign(async function matchRequest(req: OngoingRequest) {
        return _.every(await Promise.all(matchers.map((m) => m(req))));
    }, { explain: function (this: MockRule) {
        if (matchers.length === 1) return matchers[0].explain.apply(this);
        if (matchers.length === 2) {
            // With just two explanations, you can just combine them
            return `${matchers[0].explain.apply(this)} ${matchers[1].explain.apply(this)}`;
        }

        // With 3+, we need to oxford comma separate explanations to make them readable
        return matchers.slice(0, -1)
        .map((m) => <string> m.explain.apply(this))
        .join(', ') + ', and ' + matchers.slice(-1)[0].explain.apply(this);
    } });
}

function combineMatchers(matcherA: RequestMatcher, matcherB: RequestMatcher): RequestMatcher {
    return _.assign(
        (request: OngoingRequest) => matcherA(request) && matcherB(request),
        { explain: function (this: MockRule) {
            return `${matcherA.explain.apply(this)} and ${matcherB.explain.apply(this)}`;
        } }
    );
};