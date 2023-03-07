const secureIntervalTime = 300 * 1000;
const cleanBatchSize = 100;
const cleanBatchPause = 100;

class EventProxy {
    static #map = new Map();
    static #cleaningIterator = null;
    static #finalizationRegistry;

    static {
        const interval = setInterval(this.#cleanIterate.bind(this, true), secureIntervalTime);
        if (!Number.isInteger(interval)) interval.unref();
        this.#finalizationRegistry = new FinalizationRegistry((symbol) => this.off(symbol));
    }

    static #cleanIterate(start = false) {
        if (start) if (!this.#cleaningIterator) this.#cleaningIterator = this.#map.values(); else return;
        else if (!this.#cleaningIterator) return;

        try {
            let count = 0;
            const max = cleanBatchSize;
            while (true) {
                const item = this.#cleaningIterator.next();

                if (item.done) {
                    this.#cleaningIterator = null;
                    break;
                }

                const [symbol, target, eventName, listener, ref] = item.value;
                if (!ref.deref()) {
                    target.off(eventName, listener);
                    this.#map.delete(symbol);
                }

                count++;

                if (count > max) {
                    const timeout = setTimeout(this.#cleanIterate.bind(this), cleanBatchPause);
                    if (!Number.isInteger(timeout)) timeout.unref();
                    break;
                }
            }
        }
        catch {
            this.#cleaningIterator = null;        
        }
    }

    static once(target, eventName, ref, method) {
        const object = ref.deref();
        if (!object) return;
        const symbol = Symbol();
        const listener = EventProxy.proxy.bind(EventProxy, symbol);
        target.once(eventName, listener);
        this.#map.set(symbol, [symbol, target, eventName, listener, ref, method]);
        this.#finalizationRegistry.register(object, symbol);
        return symbol;
    }

    static off(symbol) {
        const item = this.#map.get(symbol);
        if (!item) return;
        const [storedSymbol, target, eventName, listener] = item;
        target.off(eventName, listener);
        this.#map.delete(symbol);
    }

    static proxy(symbol, ...args) {
        const item = this.#map.get(symbol);
        const object = item[4].deref();
        if (object) item[5].apply(object, args);
        this.#map.delete(symbol);
    }

    static get count() {
        return this.#map.size;
    }
}

export default EventProxy;