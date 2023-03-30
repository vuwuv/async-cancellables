import { printReceived, printExpected } from 'jest-matcher-utils';
import { CT } from '@async-cancellables/ct';

import syncify from './syncify.js';
import { Cancelled, Pending, Resolved, isPromiseStatus } from './symbols.js';

expect.extend({
    async toPartiallyResolve(value, expected) {
        if (value.length !== expected.length) throw new Error('toPartiallyResolve expects an array of the same length as the expected array');
        syncify(value);
        await CT.sleep(0);
        const mapped = value.map((promise, index) =>
            promise.complete
                ? promise.success
                    ? CT.isToken(promise.value)
                        ? isPromiseStatus(expected[index])
                            ? Cancelled
                            : promise.value
                        : isPromiseStatus(expected[index])
                        ? Resolved
                        : promise.value
                    : CT.isCancellationError(promise.error)
                    ? isPromiseStatus(expected[index])
                        ? Cancelled
                        : promise.error.token
                    : isPromiseStatus(expected[index])
                    ? Resolved
                    : promise.error
                : Pending
        );
        const pass = mapped.reduce((result, item, index) => result && item === expected[index], true);
        const not = pass ? 'not ' : '';

        return {
            pass,
            //message: () => `expected ${printResolved(mapped, expected)} to${not} partially resolve as ${printResolved(expected)}`,
            message: () => `expected ${printReceived(mapped)} to${not} partially resolve as ${printExpected(expected)}`,
        };
    },

    toMatchError(value, error) {
        const isString = typeof error === 'string';
        const isRegex = error instanceof RegExp;
        const isFunction = typeof error === 'function';
        if (!isString && !isRegex && !isFunction) throw new Error('toMatchError expects a string, regex or function');
        const pass = isString ? value.message === error : isRegex ? error.test(value.message) : value instanceof error;
        const not = pass ? 'not ' : '';

        return {
            pass: pass,
            message: isString
                ? () => `expected ${this.utils.printReceived(value.message)} message ${not}to match string ${this.utils.printExpected(error)}`
                : isRegex
                ? () => `expected ${this.utils.printReceived(value.message)} message ${not}to match regex ${this.utils.printExpected(error)}`
                : () => `expected class ${this.utils.printReceived(value.constructor.name)} ${not}to match error class ${this.utils.printExpected(error.name)}`,
        };
    },

    toMatchErrorMatcher(value, error) {
        if (typeof error !== 'function') throw new Error('toMatchErrorMatcher expects a function');
        const pass = error(value);
        const not = pass ? 'not ' : '';
        const message = error.message || `to match matcher ${this.utils.printExpected(error)}`;

        return {
            pass: pass,
            message: () => `expected ${this.utils.printReceived(value)} message ${not}${message}`,
        };
    },
});
