import { EOL } from 'node:os';

import syncify from './syncify.js';
import { Cancelled, Pending, Resolved } from './symbols.js';

function arraysRemoveDimensions(...arrays) {
    const array = arrays.shift() || [];
    const rest = arrays.length ? arraysRemoveDimensions(...arrays) : [[]];
    const result = [];

    for (let current of array) {
        for (let item of rest) {
            result.push([current, ...item]);
        }
    }

    return result;
}

function setNames(list) {
    for (let line of list) {
        line.unshift(line.join('/'));
    }
    return list;
}

global.Cancelled = Cancelled;
global.Pending = Pending;
global.Resolved = Resolved;

global.eachMulti = (...arrays) => it.each(setNames(arraysRemoveDimensions(...arrays)));
global.syncify = syncify;
global.consoleLog = (line, newLine = true) => process.stdout.write(line + (newLine ? EOL : ''));
process.stdout._handle.setBlocking(true);