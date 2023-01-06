import EventEmitter from 'events';
import EventProxy from './eventProxy.js';

const ManualToken = 1;
const TimeoutToken = 2;
const EventToken = 3;

function RaceResult(result, index) {
    this.result = result;
    this.index = index;
    Object.freeze(this);
}

class CancellationEventError extends Error {
    constructor(token) {
        super('Async call cancelled');
        this.token = token;
        this.name = 'CancellationTokenError';
    }
}

class CancellationToken extends EventEmitter {
    #timeout = null;
    #timeoutValue;
    #timeLeft;
    #timeStart;

    #eventEmitter;
    #eventName;

    #cancelled;
    #cancelledBy = null;

    #ref;
    #listener;

    #listenPause;
    #listenResume;

    #type;

    #throwsError;
    #allowsPause;
    #hadChildren = false;
    #hasTimeoutParent = false;

    #paused = false;
    #pauseCount = 0;

    #cancelPromise = [null, null];  

    static manual(cancelled) {
        return new CancellationToken({ type: ManualToken, cancelled });
    }

    static timeout(timeout) {
        return new CancellationToken({ type: TimeoutToken, timeout });
    }

    static event(target, eventName) {
        return new CancellationToken({ type: EventToken, target, eventName });
    }

    static isToken(token) {
        return token instanceof CancellationToken;
    }

    manual(cancelled) {
        return this.#attach(
            new CancellationToken({
                type: ManualToken,
                cancelled,
                throwsError: this.#throwsError,
                allowsPause: this.#allowsPause,
                parent: this,
                hasTimeoutParent: this.#type === TimeoutToken || this.#hasTimeoutParent || false,
            })
        );
    }

    timeout(timeout) {
        return this.#attach(
            new CancellationToken({
                type: TimeoutToken,
                timeout,
                throwsError: this.#throwsError,
                allowsPause: this.#allowsPause,
                parent: this,
                hasTimeoutParent: this.#type === TimeoutToken || this.#hasTimeoutParent || false,
            })
        );
    }

    event(target, eventName) {
        return this.#attach(
            new CancellationToken({
                type: EventToken,
                target,
                eventName,
                throwsError: this.#throwsError,
                allowsPause: this.#allowsPause,
                parent: this,
                hasTimeoutParent: this.#type === TimeoutToken || this.#hasTimeoutParent || false,
            })
        );
    }

    constructor(options) {
        options = options || {};

        super({ useWeakRefs: options.useWeakRefs });

        this.#throwsError = options.throwsError ? true : false;
        this.#allowsPause = options.allowsPause ? true : false;
        this.#hasTimeoutParent = false || options.hasTimeoutParent;
        this.#type = options.type || ManualToken;

        if (options.parent) {
            options.parent.on('cancel', this.#cancel.bind(this), this);
        }

        if (this.#type === ManualToken) {
            this.#cancelled = options.cancelled ? true : false;
            if (this.#cancelled) this.#cancelledBy = this;
        } else if (this.#type === TimeoutToken) {
            this.#cancelled = false;
            this.#timeoutValue = options.timeout || 0;
            this.#startTimer(this.#timeoutValue);
        } else if (this.#type === EventToken) {
            this.#cancelled = false;
            this.#eventEmitter = options.target;
            this.#eventName = options.eventName;
            this.#subscribeEvent();
        } else throw new Error('Invalid cancellation token type');
    }

    get throwsError() {
        return this.#throwsError;
    }

    enableThrow() {
        this.#throwsError = true;
        return this;
    }

    get allowsPause() {
        return this.#allowsPause;
    }

    allowPause() {
        if (this.#allowsPause) return this;

        if (this.#hasTimeoutParent) throw new Error('Cannot allow pause for token with timeout parent and blocked pause');
        if (this.#hadChildren) throw new Error('Cannot allow pause for token with existing children');

        this.#allowsPause = true;

        return this;
    }

    #createRef() {
        let ref = this.#ref;
        if (!ref) this.#ref = ref = new WeakRef(this);
        return ref;
    }

    #createListener() {
        if (!this.#listener) this.#listener = this.#cancel.bind(this, this);
    }

    #createCancelPromise(index) {
        if (this.#cancelPromise[index]) return this.#cancelPromise[index];
        let promise = this.#cancelPromise[index] = [null, null, null];
        promise[0] = new Promise((resolve, reject) => {
            promise[1] = resolve;
            promise[2] = reject;
        });
        return promise;
    }

    #subscribeEvent() {
        this.#createListener();
        const ref = this.#createRef();
        EventProxy.once(this.#eventEmitter, this.#eventName, ref, this.#cancel);
    }

    #unsubscribeEvent() {
        this.#eventEmitter.off(this.#eventName, this.#listener);
    }

    #startTimer(timeout) {
        this.#createListener();
        if (this.#type !== TimeoutToken) throw new Error('timeout token exclusive');
        this.#clearTimer();
        this.#timeStart = performance.now();
        this.#timeout = setTimeout(this.#listener, timeout);
    }

    #clearTimer() {
        if (this.#timeout) {
            clearTimeout(this.#timeout);
            this.#timeout = undefined;
        }
    }

    #cancel(sourceToken) {
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
    }

    #attach(token) {
        this.#hadChildren = true;
        if (!this.#listenPause) this.#listenPause = this.#pause.bind(this);
        if (!this.#listenResume) this.#listenResume = this.#resume.bind(this);
        token.on('pause', this.#listenPause, this);
        token.on('resume', this.#listenResume, this);
        return token;
    }

    cancel() {
        this.#cancel(this);
    }

    processCancel(resolve, reject, cancel) {
        const throwsError = this.#throwsError;
        this.once('cancel', (token) => {
            if (cancel) cancel();
            if (throwsError) reject(new CancellationEventError(token));
            else resolve(token);
        });
    }

    async sleep(ms, successValue, overrideThrow = null) {
        const throws = overrideThrow === null ? this.#throwsError : !!overrideThrow;
        if (this.#cancelled) return this.cancelledByControlled(throws);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve.bind(undefined, successValue), ms);

            this.once('cancel', (token) => {
                clearTimeout(timeout);
                throws ? reject(new CancellationEventError(token)) : resolve(token);
            });
        });
    }

    async wait(promise, overrideThrow = null) {
        const throws = overrideThrow === null ? this.#throwsError : !!overrideThrow;
        if (this.#cancelled) return this.cancelledByControlled(throws);
        let cancelPromise = this.#createCancelPromise(throws ? 1 : 0);
        return Promise.race([promise, cancelPromise[0]]);
    }

    async handleEvent(object, event, handler, overrideThrow = null) {
        const throws = overrideThrow === null ? this.#throwsError : !!overrideThrow;
        if (this.#cancelled) return this.cancelledByControlled(throws);
        return new Promise((resolve, reject) => {
            const waiter = function () {
                resolve(handler(...arguments));
            };

            object.once(event, waiter);

            this.once('cancel', (token) => {
                object.off(event, waiter);
                throws ? reject(new CancellationEventError(token)) : resolve(token);
            });
        });
    }

    async waitEvent(object, event, overrideThrow = null) {
        const throws = overrideThrow === null ? this.#throwsError : !!overrideThrow;
        if (this.#cancelled) return this.cancelledByControlled(throws);
        return new Promise((resolve, reject) => {
            const waiter = function () {
                resolve(Array.from(arguments));
            };

            object.once(event, waiter);

            this.once('cancel', (token) => {
                object.off(event, waiter);
                throws ? reject(new CancellationEventError(token)) : resolve(token);
            });
        });
    }

    async race(createPromises, waitSuccessful = true) {
        let result, token;

        try {
            token = this.manual();

            const promises = createPromises(token).map((promise, index) =>
                promise.then((result) => (result instanceof CancellationToken ? result : new RaceResult(result, index)))
            );

            result = waitSuccessful ? await Promise.any(promises) : await Promise.race(promises);
        }
        finally {
            token.cancel();
        }

        return result;
    }

    #pause() {
        this.#pauseCount++;

        if (this.#pauseCount === 1) {
            if (this.#timeout) {
                this.#timeLeft = this.#timeoutValue - performance.now() + this.#timeStart;
                this.#clearTimer();
            }

            if (this.#type === EventToken && !this.#cancelled) this.#unsubscribeEvent();

            this.emit('pause', this.#timeLeft);
        }
    }

    #resume() {
        this.#pauseCount--;

        if (this.#pauseCount === 0) {
            if (this.#timeLeft !== undefined) {
                this.#startTimer(this.#timeLeft);
                this.#timeLeft = undefined;
            }

            if (this.#type === EventToken && !this.#cancelled) this.#subscribeEvent();

            this.emit('resume', this.#timeLeft);
        }
    }

    pause() {
        if (!this.#allowsPause) throw new Error('Pause/resume forbidden for this token');
        if (this.#paused) throw new Error('Cannot pause paused token');
        this.#paused = true;
        this.#pause();
    }

    resume() {
        if (!this.#allowsPause) throw new Error('Pause/resume forbidden for this token');
        if (!this.#paused) throw new Error('Cannot resume non-paused token');
        this.#paused = false;
        this.#resume();
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
        if (this.#throwsError && this.#cancelledBy) throw new CancellationEventError(this.#cancelledBy);
        else return this.#cancelledBy;
    }

    cancelledByControlled(overrideThrow = null) {
        const throws = overrideThrow === null ? this.#throwsError : !!overrideThrow;
        if (throws && this.#cancelledBy) throw new CancellationEventError(this.#cancelledBy);
        else return this.#cancelledBy;
    }

    get paused() {
        return this.#paused;
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
