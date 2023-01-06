import EventProxy from "./eventProxy.js";

const ManualState = 1;
const EventState = 2;

class AsyncState {
    #setWaiters = [];
    #setPromise = null;
    #setResolve = null;

    #clearWaiters = [];
    #clearPromise = null;
    #clearResolve = null;

    #value;

    #ref;
    #eventTarget;
    #eventName;
    #eventHandler;

    static manual() {
        return new AsyncState({ type: ManualState });
    }

    static event(target, event, handler) {
        return new AsyncState({ type: EventState, target, event, handler });
    }

    constructor(options) {
        options = options || {};

        if (options.type === EventState) {
            this.#eventTarget = options.target;
            this.#eventName = options.event;
            this.#eventHandler = options.handler;
            this.#subscribe();
        }
    }

    get value() {
        return this.#value;
    }

    get valueSet() {
        return this.#value !== undefined;
    }

    #setAfterHandler(...args) {
        this.#set(this.#eventHandler(...args));
    }

    #subscribe() {
        if (this.#eventTarget) {
            if (!this.#ref) this.#ref = new WeakRef(this);
            EventProxy.once(this.#eventTarget, this.#eventName, this.#ref, this.#setAfterHandler);
        }
        //this.#eventTarget.once(this.#eventName, (...args) => this.#set.apply(this, this.#eventHandler(...args)));
    }

    set(value) {
        this.#set(value);
    }

    clear() {
        if (this.#value === undefined) throw new Error('State already cleared');
        this.#value = undefined;
        if (this.#clearPromise) this.#clearResolve();
        for (let waiter of this.#clearWaiters) waiter();
        this.#subscribe();
        this.#clearPromise = null;
        this.#clearResolve = null;
        this.#clearWaiters = [];
    }

    #set(value) {
        if (this.#value !== undefined) throw new Error('State already set');
        this.#value = value;
        if (this.#setPromise) this.#setResolve(value);
        for (let waiter of this.#setWaiters) waiter(value);
        this.#setPromise = null;
        this.#setResolve = null;
        this.#setWaiters = [];
    }

    async waitEmpty(cancellationToken = null) {
        if (this.#value === undefined) return;
        if (cancellationToken) {
            cancellationToken.throwIfCancelled();
            const waiters = this.#clearWaiters;
            const promise = new Promise((resolve, reject) => {
                cancellationToken.processCancel(resolve, reject, () => {
                    let index = waiters.indexOf(resolve);
                    if (index >= 0) waiters.splice(index, 1);
                });
                waiters.push(resolve);
            });
            return promise;            
        }
        else {
            if (!this.#clearPromise) {
                let self = this;
                this.#clearPromise = new Promise((resolve) => self.#clearResolve = resolve);
            }
            return this.#clearPromise;
        }
    }

    async wait(cancellationToken = null) {
        if (this.#value !== undefined) return this.#value;
        if (cancellationToken) {
            cancellationToken.throwIfCancelled();
            const waiters = this.#setWaiters;
            const promise = new Promise((resolve, reject) => {
                cancellationToken.processCancel(resolve, reject, () => {
                    let index = waiters.indexOf(resolve);
                    if (index >= 0) waiters.splice(index, 1);
                });
                waiters.push(resolve);
            });
            return promise;            
        }
        else {
            if (!this.#setPromise) {
                let self = this;
                this.#setPromise = new Promise((resolve) => self.#setResolve = resolve);
            }
            return this.#setPromise;
        }
    }
}

export default AsyncState;