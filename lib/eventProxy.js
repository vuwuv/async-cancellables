class EventProxy {
    static #map = new Map();
    static #added = 0;
    static #cleaning = false;
    static #lastCleaned;

    static {
        const interval = setInterval(this.#checkClean.bind(this), 120 * 1000);
        if (!Number.isInteger(interval)) interval.unref();
    }

    static #checkClean() {
        if (performance.now() - this.#lastCleaned > 100 * 1000) this.#clean();
    }

    static async #clean() {
        if (this.#cleaning) return;
        this.#cleaning = true;
        this.#added = 0;

        try {
            let count = 0;

            for (let [symbol, [target, eventName, listener, ref]] of this.#map) {
                if (!ref.deref()) {
                    target.off(eventName, listener);
                    this.#map.delete(symbol);
                }

                count++;

                if (count > 100 && count > this.#map.size * 0.1) {
                    await sleep(100);
                    count = 0;
                }
            }

            this.#lastCleaned = performance.now();
        }
        finally {
            this.#cleaning = false;
        }
    }

    static once(target, eventName, ref, method) {
        const symbol = Symbol();
        const listener = EventProxy.proxy.bind(EventProxy, symbol);
        target.once(eventName, listener);
        this.#map.set(symbol, [target, eventName, listener, ref, method]);
        this.#added++;
        if (this.#added > 100) this.#clean();
    }

    static off(symbol) {
        const [target, eventName, listener] = this.#map.get(symbol);
        target.off(eventName, listener);
        this.#map.delete(symbol);
    }

    static proxy(symbol, ...args) {
        const [target, eventName, listener, ref, method] = this.#map.get(symbol);
        const object = ref.deref();
        if (object) method.apply(object, args);
        this.#map.delete(symbol);
    }

    static get count() {
        return this.#map.size;
    }
}

export default EventProxy;