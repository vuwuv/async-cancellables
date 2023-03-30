import { CT } from 'async-cancellables';

import { SocketioClientTransport } from './socketioTransport.js';

const returnTrue = () => true;

class AsyncRpcRemoteResource {
    #release;
    #waitRelease;

    constructor(release, waitRelease) {
        this.#release = release;
        this.#waitRelease = waitRelease;
    }

    release() {
        this.#release();
    }

    async waitRelease(ct = null) {
        return this.#waitRelease(ct);
    }
}

const connectionClosedSymbol = Symbol('connection closed');
const requestTimeoutSymbol = Symbol('request timeout');
const AsyncRpcClientMarkers = Object.freeze({
    ConnectionClosed: connectionClosedSymbol,
    RequestTimeout: requestTimeoutSymbol
});

class AsyncRpcClient {
    #transport;
    #connectionToken;
    #nextId = 0;
    #connected = false;
    #requestTimeout;

    static socketio(socket, methods, options) {
        const transport = new SocketioClientTransport(socket);
        return new AsyncRpcClient(transport, methods, options);
    }

    constructor(transport, methods, options) {
        this.#transport = transport;

        if (options) {
            if (options.requestTimeout) {
                if (Number.isInteger(options.requestTimeout)) this.#requestTimeout = options.requestTimeout;
                else throw new Error('requestTimeout should be an integer');
            }            
        }

        for (let methodName of methods) {
            this[methodName] = this.#call.bind(this, methodName);
        }

        if (transport.connected) this.#onConnected();
        else this.#connectionToken = CT.manual(connectionClosedSymbol).cancel();

        transport.on('open', this.#onConnected.bind(this));
        transport.on('close', this.#onDisconnected.bind(this));
    }

    connect() {
        this.#transport.connect();
    }

    disconnect() {
        this.#transport.disconnect();
    }

    get connected() {
        return this.#connected;
    }

    async waitConnected(ct = null) {
        if (this.#connected) return true;
        return CT.handleEvent(this.#transport, 'open', returnTrue, ct);
    }

    async waitDisconnected(ct = null) {
        if (!this.#connected) return true;
        return CT.handleEvent(this.#transport, 'close', returnTrue, ct);
    }
    
    #onConnected() {
        this.#connected = true;
        this.#connectionToken = CT.event(this.#transport, 'close', connectionClosedSymbol);
    }

    #onDisconnected() {
        this.#connected = false;
    }

    #getId() {
        this.#nextId++;
        if (this.#nextId === Number.MAX_SAFE_INTEGER) this.#nextId = 0;
        return this.#nextId.toString();
    }

    #onCancel(id) {
        this.#transport.send('cancel', id);
        this.#transport.removeAllListeners(`result_${id}`);
        this.#transport.removeAllListeners(`confirmCall_${id}`);
    }

    #release(id) {
        this.#transport.send(`release`, id);
    }

    #onCancelWaitRelease(id) {
        this.#transport.removeAllListeners(`confirmRelease_${id}`);
    }

    #onConfirmRelease(id, resolve, reject, success, error) {
        if (success) resolve();
        else reject(new Error(error));
    }

    async #waitRelease(id, ct = null) {
        return new Promise((resolve, reject) => {
            if (ct) [resolve, reject] = ct.processCancel(resolve, reject, this.#onCancelWaitRelease.bind(this, id));
            this.#transport.send(`release`, id, true);
            this.#transport.once(`confirmRelease_${id}`, this.#onConfirmRelease.bind(this, id, resolve, reject));
        });
    }

    #result(resolve, reject, id, type, result) {
        if (type === 'value') {
            resolve(result);
        } 
        else if (type === 'resource') {
            resolve(new AsyncRpcRemoteResource(this.#release.bind(this, id), this.#waitRelease.bind(this, id)));
        }
        else if (type === 'error') {
            reject(new Error(result));
        } 
        else {
            reject(new Error(`Unknown result type: ${type}`));
        }
    }

    #confirmed(requestToken, callToken) {
        callToken.detachFrom(requestToken);
    }

    #call(methodName, ct = null, ...args) {
        const requestToken = this.#requestTimeout ? CT.timeout(this.#requestTimeout, requestTimeoutSymbol) : null;
        const callToken = CT.manual().attachTo(ct, this.#connectionToken, requestToken);
        callToken.throwIfCancelled();
        const id = this.#getId();
        this.#transport.send('call', id, methodName, args);
        if (requestToken) this.#transport.once(`confirmCall_${id}`, this.#confirmed.bind(this, requestToken, callToken));
        return new Promise((resolve, reject) => {
            [resolve, reject] = callToken.processCancel(resolve, reject, this.#onCancel.bind(this, id));
            this.#transport.once(`result_${id}`, this.#result.bind(this, resolve, reject, id));
        });
    }
}

export default AsyncRpcClient;
export { AsyncRpcRemoteResource, AsyncRpcClient, AsyncRpcClientMarkers }