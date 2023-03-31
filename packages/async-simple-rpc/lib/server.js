import { CT } from 'async-cancellables';

import { SocketioServerTransport } from './socketioTransport.js';

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

class AsyncRpcServer {
    #transport;
    #methods;
    #resourceClasses = new Map();
    #openBound;

    static socketio(serverSocket, methods, options) {
        const transport = new SocketioServerTransport(serverSocket);
        return new AsyncRpcServer(transport, methods, options);
    }

    constructor(transport, methods, options) {
        this.#transport = transport;
        this.#methods = {};

        for (let methodName in methods) {
            const method = methods[methodName];
            if (typeof method !== 'function') throw new Error(`Method is not a function: ${methodName}`);
            this.#methods[methodName] = method;
        }

        options = options || {};
        const resourceClasses = options.resourceClasses;

        if (resourceClasses) {
            if (resourceClasses instanceof Map) {
                for (let [resourceClass, releaseMethodName] of resourceClasses) {
                    if (typeof resourceClass !== 'function') throw new Error('resourceClasses keys should be constructors');
                    if (typeof releaseMethodName !== 'string') throw new Error('resourceClasses values should be strings');
                }
                this.#resourceClasses = resourceClasses;
            }
            else if (resourceClasses instanceof Array) {
                for (let i = 0; i < resourceClasses.length; i += 2) {
                    if (typeof resourceClasses[i] !== 'function') throw new Error(`Expected constructor at index ${i} in resourceClasses`);
                    if (typeof resourceClasses[i + 1] !== 'string') throw new Error(`Expected string at index ${i + 1} in resourceClasses`);
                    this.#resourceClasses.set(resourceClasses[i], resourceClasses[i + 1]);
                }
            }
            else throw new Error('resourceClasses should be Map or Array');
        }

        if (!this.#openBound) this.#openBound = this.#onOpen.bind(this);
        this.#transport.on('open', this.#openBound);
    }

    // process new connection
    #onOpen(connection) {
        const connectionToken = CT.manual();
        const resources = new Map();
        connection.on('call', this.#onCall.bind(this, connection, connectionToken, resources));
        connection.on('release', this.#onRelease.bind(this, connection, resources));
        connection.on('close', this.#onClose.bind(this, connection, connectionToken, resources));
        connection.on('cancel', this.#onCancel.bind(this, connection));
    }

    // process cancel request
    #onCancel(connection, id) {
        connection.emit(`cancel_${id}`);
        connection.emit('release', id);
    }

    // process release request
    #onRelease(connection, resources, id, shouldConfirm = false) {
        const resource = resources.get(id);
        if (resource) {
            const releaseMethodName = this.#resourceClasses.get(resource.constructor);
            try {
                resource[releaseMethodName]();
            }
            catch (error) {
                console.warn(`Error releasing resource ${resource.constructor.name}.${releaseMethodName}: ${error.message}`);
            }
        }
        else if (shouldConfirm) connection.send(`confirmRelease_${id}`, false, 'Resource not found');
        if (shouldConfirm) connection.send(`confirmRelease_${id}`, true);
        resources.delete(id);
    }

    // process new call request
    #onCall(connection, connectionToken, resources, id, methodName, methodArgs) {
        const callToken = CT.manual().attachTo(connectionToken);
        const method = this.#methods[methodName];

        if (!method) {
            this.#sendError(connection, id, new Error(`Method not found: ${methodName}`));
            return;
        }

        connection.send(`confirmCall_${id}`, true);

        if (method instanceof AsyncFunction) {
            const cancelBound = callToken.cancel.bind(callToken)
            connection.once(`cancel_${id}`, cancelBound);

            callToken.once('cancel', this.#onTokenCancel.bind(this, connection, id, cancelBound));

            method(callToken, ...methodArgs).then(this.#sendResult.bind(this, connection, resources, id), this.#sendError.bind(this, connection, id));
        }
        else {
            try {
                this.#sendResult(connection, resources, id, method(...methodArgs));
            }
            catch (error) {
                this.#sendError(connection, id, error);
            }
        }
    }

    // process token cancelllation
    #onTokenCancel(connection, id, cancelBound) {
        connection.removeAllListeners(`cancel_${id}`, cancelBound);
    }

    // process connection close
    #onClose(connection, connectionToken, resources) {
        connection.removeAllListeners();
        connectionToken.cancel();
        for (let resource of resources.values()) {
            const releaseMethodName = this.#resourceClasses.get(resource.constructor);
            try {
                resource[releaseMethodName]();
            }
            catch (error) {
                console.warn(`Error releasing resource ${resource.constructor.name}.${releaseMethodName}: ${error.message}`);
            }
        }
    }

    // send error to client
    #sendError(connection, id, error) {
        if (!CT.isCancellationError(error)) {
            connection.send(`result_${id}`, 'error', error.message);
        }
    }

    // send result to client
    #sendResult(connection, resources, id, result) {
        let isResource = false;
        if (typeof result === 'object') {
            const releaseMethodName = this.#resourceClasses.get(result.constructor);
            if (releaseMethodName) {
                isResource = true;
                if (typeof result[releaseMethodName] !== 'function') {
                    connection.send(`result_${id}`, 'error', `Internal error: invalid resource`);
                    console.warn(`Resource class ${result.constructor.name} should have a method named ${releaseMethodName} to release the resource`);
                }
                else {
                    resources.set(id, result);
                    connection.send(`result_${id}`, 'resource');
                }
            }
        }
        
        if (!isResource) connection.send(`result_${id}`, 'value', result);
    }

    destroy() {
        this.#transport.off('open', this.#openBound);
        this.#transport.shutdownRpc();
    }
}

export default AsyncRpcServer;