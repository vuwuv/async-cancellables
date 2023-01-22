import EventEmitter from 'events';
import EventProxy from './eventProxy.js';
import sleep from './sleep.js';

const ManualToken = 1;
const TimeoutToken = 2;
const EventToken = 3;

function RaceResult(result, index) {
    this.result = result;
    this.index = index;
    Object.freeze(this);
}

function createRaceResult(index, result) {
    return new RaceResult(result, index);
}

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
    #parents;

    #type;

    #cancelPromise = [null, null];

    static manual(parents = null) {
        return new CancellationToken({ type: ManualToken, parents });
    }

    static timeout(timeout, parents = null) {
        return new CancellationToken({ type: TimeoutToken, timeout, parents });
    }

    static event(target, eventName, parents = null) {
        return new CancellationToken({ type: EventToken, target, eventName, parents });
    }

    static isToken(token) {
        return token instanceof CancellationToken;
    }

    static isCancellationError(error) {
        return error instanceof CancellationEventError;
    }

    static async sleep(cancellationToken, ms, successValue, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.sleep(ms, successValue, doNotThrow);
        else return sleep(ms, successValue);
    }

    static async wait(cancellationToken, promise, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.wait(promise, doNotThrow);
        else return promise;
    }

    static async waitEvent(cancellationToken, target, event, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.waitEvent(target, event, doNotThrow);
        else return new Promise((resolve) => target.once(event, (...args) => resolve(args)));
    }

    static async handleEvent(cancellationToken, target, event, handler, doNotThrow = false) {
        if (cancellationToken instanceof CancellationToken) return cancellationToken.handleEvent(target, event, handler, doNotThrow);
        else return new Promise((resolve) => target.once(event, (...args) => resolve(handler(...args))));
    }

    manual(parents = null) {
        return CancellationToken.manual(parents ? [this, ...parents] : [this]);
    }

    timeout(timeout, parents = null) {
        return CancellationToken.timeout(timeout, parents ? [this, ...parents] : [this]);
    }

    event(target, eventName, parents = null) {
        return CancellationToken.event(target, eventName, parents ? [this, ...parents] : [this]);
    }

    constructor(options) {
        options = options || {};

        super();

        this.#type = options.type || ManualToken;

        if (options.parents) this.#attachTo(options.parents);

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

    #createListener() {
        if (!this.#listener) this.#listener = this.#cancel.bind(this, this);
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

    #subscribeEvent() {
        this.#createListener();
        EventProxy.once(this.#eventEmitter, this.#eventName, this.ref, this.#cancel);
    }

    #unsubscribeEvent() {
        this.#eventEmitter.off(this.#eventName, this.#listener);
    }

    #startTimer(timeout) {
        this.#createListener();
        if (this.#type !== TimeoutToken) throw new Error('timeout token exclusive');
        this.#clearTimer();
        this.#timeout = setTimeout(this.#listener, timeout);
    }

    #clearTimer() {
        if (this.#timeout) {
            clearTimeout(this.#timeout);
            this.#timeout = undefined;
        }
    }

    #cancel(sourceToken, error) {
        if (!sourceToken) sourceToken = this;
        if (this.#type === TimeoutToken) this.#clearTimer();
        else if (this.#type === ManualToken);
        else if (this.#type === EventToken) this.#unsubscribeEvent();

        this.emit('cancel', sourceToken);

        if (this.#cancelPromise) {
            if (this.#cancelPromise[1]) this.#cancelPromise[1][2](new CancellationEventError(sourceToken));
            if (this.#cancelPromise[0]) this.#cancelPromise[0][1](sourceToken);
            this.#cancelPromise = [null, null];
        }

        this.#cancelled = true;
        this.#cancelledBy = sourceToken;
        this.#cancelledError = error;
    }

    cancel(error = null) {
        if (!this.#cancelled) this.#cancel(this, error);
        return this;
    }

    #attachTo(parents) {
        let isMap = this.#parents instanceof Map, ref;

        for (let parent of parents) {
            if (parent !== null && !(parent instanceof CancellationToken)) throw new Error('Invalid parent ' + parent);
            if (!parent) continue;

            if (!isMap && this.#parents && this.#parents[0] !== parent) {
                this.#parents = new Map([this.#parents]);
                isMap = true;
            }

            if (isMap ? !this.#parents.has(parent) : !this.#parents || this.#parents[0] !== parent) {
                let sub = null;
                if (!this.#cancelled) {
                    if (parent.cancelled) this.#cancel(parent.cancelledBy);
                    else {
                        ref = ref || this.ref;
                        sub = EventProxy.once(parent, 'cancel', ref, this.#cancel);
                    }
                }
                isMap ? this.#parents.set(parent, sub) : (this.#parents = [parent, sub]);
            }
        }
    }

    #detachFrom(parents) {
        if (!this.#parents) return;
        const isMap = this.#parents instanceof Map;

        for (let parent of parents) {
            if (!parent) continue;
            let sub = isMap ? this.#parents.get(parent) : this.#parents[0] === parent ? this.#parents[1] : undefined;
            if (sub !== undefined) {
                if (sub) EventProxy.off(sub);
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
        const onCancel = (token) => {
            if (cancel) cancel();
            if (doNotThrow) resolve(token);
            else reject(new CancellationEventError(token));
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
                doNotThrow ? resolve(token) : reject(new CancellationEventError(token));
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
                doNotThrow ? resolve(token) : reject(new CancellationEventError(token));
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
                doNotThrow ? resolve(token) : reject(new CancellationEventError(token));
            });
        });
    }

    async race(promiseListGenerator, doNotThrow = false) {
        let result, token;

        try {
            token = this.manual();

            const promises = promiseListGenerator(token).map((promise, index) =>
                promise.then(createRaceResult.bind(null, index), createRaceError.bind(null, index))
            );

            const cancelPromise = this.#createCancelPromise(1);
            promises.unshift(cancelPromise[0]);

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

    async any(promiseListGenerator, doNotThrow = false) {
        let result, token;

        try {
            token = this.manual();

            const promises = promiseListGenerator(token).map((promise, index) =>
                promise.then(createRaceResult.bind(null, index))
            );

            const cancelPromise = this.#createCancelPromise(1);

            result = await Promise.race([cancelPromise[0], Promise.any(promises)]);
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
        try {
            return await promise;
        } catch (error) {
            if (error instanceof CancellationEventError) return error.token;
            else throw error;
        }
    }

    async catchCancelError(promise) {
        try {
            return await promise;
        } catch (error) {
            if (error instanceof CancellationEventError) return error.token;
            else throw error;
        }
    }

    throwIfCancelled() {
        if (this.#cancelledBy) throw new CancellationEventError(this.#cancelledBy);
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
}

export default CancellationToken;
