import EventEmitter from 'node:events';

class SocketioClientTransport extends EventEmitter {
    #socket;

    constructor(socket) {
        super();
        this.#socket = socket;
        this.#socket.on('connect', this.#onOpen.bind(this));
        this.#socket.on('message', this.#onMessage.bind(this));
        this.#socket.on('disconnect', this.#onClose.bind(this));
    }
    
    #onOpen() {
        this.emit('open');
    }

    #onMessage(...args) {
        this.emit(...args);
    }

    #onClose() {
        this.emit('close');
    }

    send(...args) {
        this.#socket.emit('message', ...args);
    }

    connect() {
        this.#socket.connect();
    }

    disconnect() {
        this.#socket.close();
    }

    get connected() {
        return this.#socket.connected;
    }
}

class SocketioServerConnection extends EventEmitter {
    #socket;

    constructor(socket) {
        super();
        this.#socket = socket;
        this.#socket.on('message', this.#onMessage.bind(this));
        this.#socket.on('disconnect', this.#onClose.bind(this));
    }

    #onClose() {
        this.emit('close');
    }

    #onMessage(message, ...args) {
        this.emit(message, ...args);
    }

    send(...args) {
        this.#socket.emit('message', ...args);
    }
}

class SocketioServerTransport extends EventEmitter {
    static #rpcListeners = new Set();
    #serverSocket;

    constructor(serverSocket) {
        super();

        if (SocketioServerTransport.#rpcListeners.has(serverSocket)) throw new Error('socket.io server already used for RPC');
        SocketioServerTransport.#rpcListeners.add(serverSocket);

        this.#serverSocket = serverSocket;
        serverSocket.on('connection', (socket) => {
            this.emit('open', new SocketioServerConnection(socket));
        });
    }

    shutdownRpc() {
        SocketioServerTransport.#rpcListeners.delete(this.#serverSocket);
    }
}

export { SocketioClientTransport, SocketioServerTransport };