import EventEmitter from 'events';
import EventProxy from './lib/eventProxy.js';
import sleep from './lib/sleep.js';

const ManualToken = 1;
const TimeoutToken = 2;
const EventToken = 3;

class RaceSuccess {
    static create(index, value) {
        return new RaceSuccess(value, index);
    }

    constructor(value, index) {
        this.value = value;
        this.index = index;
        Object.freeze(this);
    }
}

Object.defineProperty(RaceSuccess, "result", { enumerable: false, get: function() { return this.value; } });

class RaceError extends Error {
    constructor(error, index) {
        super('Race indexed error');
        this.error = error;
        this.index = index;
        this.name = 'RaceError';
    }
}

function createRaceError(index, error) {
    return new RaceError(error, index);
}

class CancellationEventError extends Error {
    static create(token) {
        return new CancellationEventError(token);
    }

    constructor(token, error) {
        super('Async call cancelled');
        this.token = token;
        this.error = error;
        this.name = 'CancellationTokenError';
    }
}

class CancellationToken extends EventEmitter {
    #timeout = null;
    #timeoutValue;

    #eventEmitter;
    #eventName;

    #cancelled = false;
    #cancelledBy = null;
    #cancelledError = null;

    #ref;
    #listener;
    #proxyListener;
    #parents;

    #type;
    #name = null;
    #createError = CancellationEventError.create;

    #cancelPromise = [null, null];

    static manual(options = null) {
        return new CancellationToken({ type: ManualToken, options });
    }

    static timeout(timeout, options = null) {
        return new CancellationToken({ type: TimeoutToken, timeout, options });
    }

    static event(target, eventName, options = null) {
        return new CancellationToken({ type: EventToken, target, eventName, options });
    }

    static get EventProxy() {
        return EventProxy;
    }

    static isToken(token) {
        return token instanceof CancellationToken;
    }

    static isCancellationError(error) {
        return error instanceof CancellationEventError;
    }

    static async sleep(ms, successValue, cancellationToken = null, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.sleep(ms, successValue, doNotThrow);
        else return sleep(ms, successValue);
    }

    static async wait(promise, cancellationToken = null, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.wait(promise, doNotThrow);
        else return promise;
    }

    static async waitEvent(target, event, cancellationToken = null, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.waitEvent(target, event, doNotThrow);
        else return new Promise((resolve) => target.once(event, (...args) => resolve(args)));
    }

    static async handleEvent(target, event, handler, cancellationToken = null, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.handleEvent(target, event, handler, doNotThrow);
        else return new Promise((resolve) => target.once(event, (...args) => resolve(handler(...args))));
    }

    manual(options = null) {
        return new CancellationToken({ type: ManualToken, options, parent: this });
    }

    timeout(timeout, options = null) {
        return new CancellationToken({ type: TimeoutToken, timeout, options, parent: this });        
    }

    event(target, eventName, options = null) {
        return new CancellationToken({ type: EventToken, target, eventName, options, parent: this });
    }

    constructor(options) {
        options = options || {};

        super();

        this.#type = options.type || ManualToken;

        let parents, name, createError = null, parent = options.parent;
        const userOptions = options.options;

        if (userOptions) {
            if (typeof userOptions === 'string' || typeof userOptions === 'symbol') name = userOptions;
            else if (userOptions instanceof Function) createError = userOptions;
            else if (Array.isArray(userOptions)) parents = userOptions;
            else if (typeof userOptions === 'object') {
                if (userOptions.name) name = userOptions.name;
                if (userOptions.parents) parents = userOptions.parents;
                if (userOptions.createError) createError = userOptions.createError;
            }
        }

        if (parent) this.#attachTo(parent);
        if (parents) this.#attachTo(parents);
        if (name !== undefined) this.#name = name;
        if (createError !== null) this.#createError = createError;

        if (this.#type === ManualToken) {
        } else if (this.#type === TimeoutToken) {
            this.#timeoutValue = options.timeout || 0;
            this.#startTimer(this.#timeoutValue);
        } else if (this.#type === EventToken) {
            this.#eventEmitter = options.target;
            this.#eventName = options.eventName;
            this.#subscribeEvent();
        } else throw new Error('Invalid cancellation token type');
    }

    get ref() {
        let ref = this.#ref;
        if (!ref) this.#ref = ref = new WeakRef(this);
        return ref;
    }

    #getListener() {
        if (!this.#listener) this.#listener = this.#cancel.bind(this, this);
        return this.#listener;
    }

    #createCancelPromise(index) {
        if (this.#cancelPromise[index]) return this.#cancelPromise[index];
        let promise = (this.#cancelPromise[index] = [null, null, null]);
        promise[0] = new Promise((resolve, reject) => {
            promise[1] = resolve;
            promise[2] = reject;
        });
        return promise;
    }

    #listenProxy() {
        this.#cancel(this);
    }

    #subscribeEvent() {
        this.#proxyListener = EventProxy.once(this.#eventEmitter, this.#eventName, this.ref, this.#listenProxy);
    }

    #unsubscribeEvent() {
        if (this.#proxyListener) EventProxy.off(this.#proxyListener);
    }

    #startTimer(timeout) {
        if (this.#type !== TimeoutToken) throw new Error('timeout token exclusive');
        this.#clearTimer();
        this.#timeout = setTimeout(this.#getListener(), timeout);
    }

    #clearTimer() {
        if (this.#timeout) {
            clearTimeout(this.#timeout);
            this.#timeout = undefined;
        }
    }

    #cancel(sourceToken, error) {
        if (this.#cancelled) return;
        if (!sourceToken) sourceToken = this;
        if (this.#type === TimeoutToken) this.#clearTimer();
        else if (this.#type === ManualToken);
        else if (this.#type === EventToken) this.#unsubscribeEvent();

        if (!error) error = this.#createError(sourceToken);

        this.emit('cancel', sourceToken, error);

        if (this.#cancelPromise) {
            if (this.#cancelPromise[1]) this.#cancelPromise[1][2](error);
            if (this.#cancelPromise[0]) this.#cancelPromise[0][1](sourceToken);
            this.#cancelPromise = [null, null];
        }
        
        if (this.#parents) {
            if (this.#parents instanceof Map) {
                for (let sub of this.#parents.values()) EventProxy.off(sub);
            }
            else if (this.#parents) {
                EventProxy.off(this.#parents[1]);
            }
        }

        this.#cancelled = true;
        this.#cancelledBy = sourceToken;
        this.#cancelledError = error;
    }

    cancel() {
        if (!this.#cancelled) this.#cancel(this);
        return this;
    }

    #attachTo(parents) {
        if (!parents) return;
        let isMap = this.#parents instanceof Map, ref;
        let count, parent, i = 0;

        if (Array.isArray(parents)) {
            count = parents.length;
            parent = parents[0];
            if (count === 0) return;
        } else {
            count = 1;
            parent = parents;
        }

        while (true) {
            if (parent !== null && !(parent instanceof CancellationToken)) throw new Error('Invalid parent ' + parent);
            
            if (parent) {
                if (!isMap && this.#parents && this.#parents[0] !== parent) {
                    this.#parents = new Map([this.#parents]);
                    isMap = true;
                }

                if (isMap ? !this.#parents.has(parent) : !this.#parents || this.#parents[0] !== parent) {
                    let sub = null;
                    if (!this.#cancelled) {
                        if (parent.cancelled) this.#cancel(parent.cancelledBy, parent.cancelledError);
                        else {
                            ref = ref || this.ref;
                            sub = EventProxy.once(parent, 'cancel', ref, this.#cancel);
                        }
                    }
                    isMap ? this.#parents.set(parent, sub) : (this.#parents = [parent, sub]);
                }
            }

            i++;
            if (i >= count) break;
            parent = parents[i];
        }
    }

    #detachFrom(parents) {
        if (!this.#parents) return;
        const isMap = this.#parents instanceof Map;

        for (let parent of parents) {
            if (!parent) continue;
            let sub = isMap ? this.#parents.get(parent) : this.#parents[0] === parent ? this.#parents[1] : undefined;
            if (sub) {
                EventProxy.off(sub);
                isMap ? this.#parents.delete(parent) : this.#parents = undefined;
                if (!isMap) return;
            }
        }
    }

    attachTo(...parents) {
        this.#attachTo(parents);
        return this;
    }

    detachFrom(...parents) {
        this.#detachFrom(parents);
        return this;
    }

    processCancel(resolve, reject, cancel, doNotThrow = false) {
        const onCancel = (token, error) => {
            if (cancel) cancel();
            if (doNotThrow) resolve(token);
            else reject(error);
        };

        this.once('cancel', onCancel);

        const off = () => {
            this.off('cancel', onCancel);
            return true;
        }

        return [value => off() && resolve(value), value => off() && reject(value)];
    }

    async sleep(ms, successValue = true, doNotThrow = false) {
        if (!doNotThrow) this.throwIfCancelled();
        else if (this.#cancelled) return this.#cancelledBy;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve.bind(undefined, successValue), ms);

            this.once('cancel', (token) => {
                clearTimeout(timeout);
                doNotThrow ? resolve(token) : reject(this.#createError(token));
            });
        });
    }

    async wait(promise, doNotThrow = false) {
        if (!doNotThrow) this.throwIfCancelled();
        else if (this.#cancelled) return this.#cancelledBy;
        if (this.#cancelled) return this.cancelledByControlled(throws);
        let cancelPromise = this.#createCancelPromise(doNotThrow ? 0 : 1);
        return Promise.race([promise, cancelPromise[0]]);
    }

    async waitEvent(target, event, doNotThrow = false) {
        if (!doNotThrow) this.throwIfCancelled();
        else if (this.#cancelled) return this.#cancelledBy;
        return new Promise((resolve, reject) => {
            const waiter = function () {
                resolve(Array.from(arguments));
            };

            target.once(event, waiter);

            this.once('cancel', (token) => {
                target.off(event, waiter);
                doNotThrow ? resolve(token) : reject(this.#createError(token));
            });
        });
    }

    async handleEvent(target, event, handler, doNotThrow = false) {
        if (!doNotThrow) this.throwIfCancelled();
        else if (this.#cancelled) return this.#cancelledBy;
        return new Promise((resolve, reject) => {
            const waiter = function () {
                resolve(handler(...arguments));
            };

            target.once(event, waiter);

            this.once('cancel', (token) => {
                target.off(event, waiter);
                doNotThrow ? resolve(token) : reject(this.#createError(token));
            });
        });
    }

    static async #race(cancelPromise, promiseListGenerator, doNotThrow = false) {
        let result, token;

        try {
            token = this.manual();

            const promises = promiseListGenerator(token).map((promise, index) =>
                promise.then(RaceSuccess.create.bind(null, index), createRaceError.bind(null, index))
            );

            if (cancelPromise) promises.unshift(cancelPromise);

            result = await Promise.race(promises);
        } 
        catch (error) {
            if (doNotThrow) result = error.token;
            else throw error;
        }        
        finally {
            token.cancel();
        }

        if (result instanceof RaceError) throw result;
        return result;
    }

    static async #any(cancelPromise, promiseListGenerator, doNotThrow = false) {
        let result, token;

        try {
            token = this.manual();

            const promises = promiseListGenerator(token).map((promise, index) =>
                promise.then(RaceSuccess.create.bind(null, index))
            );

            if (cancelPromise) result = await Promise.race([cancelPromise, Promise.any(promises)]);
            else result = await Promise.any(promises);
        }   
        catch (error) {
            if (doNotThrow && error instanceof CancellationEventError) result = error.token;
            else throw error;
        }    
        finally {
            token.cancel();
        }

        return result;
    }

    static async race(promiseListGenerator, doNotThrow = false) {
        return CancellationToken.#race(null, promiseListGenerator, doNotThrow);
    }

    static async any(promiseListGenerator, doNotThrow = false) {
        return CancellationToken.#any(null, promiseListGenerator, doNotThrow);
    }

    async race(promiseListGenerator, doNotThrow = false) {
        if (!doNotThrow) this.throwIfCancelled();
        else if (this.#cancelled) return this.#cancelledBy;
        const cancelPromise = this.#createCancelPromise(1)[0];
        return CancellationToken.#race(cancelPromise, promiseListGenerator, doNotThrow);
    }

    async any(promiseListGenerator, doNotThrow = false) {
        if (!doNotThrow) this.throwIfCancelled();
        else if (this.#cancelled) return this.#cancelledBy;
        const cancelPromise = this.#createCancelPromise(1)[0];
        return CancellationToken.#any(cancelPromise, promiseListGenerator, doNotThrow);
    }

    isToken(token) {
        return token instanceof CancellationToken;
    }

    get isCancellationToken() {
        return true;
    }

    get cancelled() {
        return this.#cancelled;
    }

    get cancelledBy() {
        return this.#cancelledBy;
    }

    get cancelledError() {
        return this.#cancelledError;
    }

    static async catchCancelError(promise) {
        return promise.catch(error => { if (error instanceof CancellationEventError) return error.token; else throw error });
    }

    async catchCancelError(promise) {
        return promise.catch(error => { if (error instanceof CancellationEventError) return error.token; else throw error });
    }

    throwIfCancelled() {
        if (this.#cancelledBy) throw this.#cancelledError;
    }

    get isTimeout() {
        return this.#type === TimeoutToken;
    }

    get isManual() {
        return this.#type === ManualToken;
    }

    get isEvent() {
        return this.#type === EventToken;
    }

    get type() {
        return this.#type;
    }

    get name() {
        return this.#name;
    }
}

export default CancellationToken;
export { CancellationEventError, RaceError, RaceSuccess, EventProxy, sleep };