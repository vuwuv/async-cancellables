import { EOL } from 'node:os';

import CT from '@async-cancellables/ct';

const pendingSymbol = Symbol();

expect.extend({
    toPartiallyResolve(value, list) {
        const mapped = value.map((item) => (item === pendingSymbol ? 0 : CT.isToken(item) ? 2 : 1));
        const pass = mapped.reduce((result, item, index) => result && item === list[index], true);

        if (pass) {
            return {
                pass: true,
            };
        } else {
            return {
                message: () => `expected ${this.utils.printReceived(mapped)} to partially resolve as ${this.utils.printExpected(list)}`,
                pass: false,
            };
        }
    },
});

const promiseCheck = async function(promises) {
    return await Promise.all(promises.map((promise) => Promise.race([promise, CT.sleep(1, pendingSymbol)])));
};

promiseCheck.pendingSymbol = pendingSymbol;

global.promiseCheck = promiseCheck;
global.consoleLog = (line, newLine = true) => process.stdout.write(line + (newLine ? EOL : ""));
process.stdout._handle.setBlocking(true);