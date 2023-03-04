const minSpeed = 3.3 / 1000;
const secureIntervalTime = 30 * 1000;
const defaultSleepMultiplier = 0.5;
const cleanBatchSize = 100;

class EventProxy {
    static #map = new Map();
    static #added = 0;
    //static #deleted = 0;
    static #addSpeed = minSpeed;
    static #lastCleaned;
    static #cleaningIterator = null;
    static #timeMultiplier = defaultSleepMultiplier;

    static {
        const interval = setInterval(this.#clean.bind(this), secureIntervalTime);
        if (!Number.isInteger(interval)) interval.unref();
        this.#lastCleaned = performance.now();
    }

    static #cleanIterate() {
        if (!this.#cleaningIterator) return;
        let count = 0;
        const max = cleanBatchSize;
        const sleep = max / this.#addSpeed * this.#timeMultiplier;
        while (true) {
            const item = this.#cleaningIterator.next();

            if (item.done) {
                this.#cleaningIterator = null;
                //this.#deleted = 0;
                break;
            }

            const [symbol, target, eventName, listener, ref] = item.value;
            if (!ref.deref()) {
                target.off(eventName, listener);
                this.#map.delete(symbol);
            }

            count++;

            if (count > max) {
                //this.#deleted += count;
                const timeout = sleep > 10 ? setTimeout(this.#cleanIterate.bind(this), sleep) : setImmediate(this.#cleanIterate.bind(this));
                if (timeout && !Number.isInteger(timeout)) timeout.unref();
                break;
            }
        }
    }

    static #clean() {
        const now = performance.now();
        const addSpeed = Math.max(this.#added / (now - this.#lastCleaned), minSpeed);
        this.#addSpeed = this.#addSpeed ? addSpeed : (this.#addSpeed + 2 * addSpeed) / 3;
        this.#lastCleaned = now;
        this.#added = 0
        if (this.#cleaningIterator) return;
        this.#cleaningIterator = this.#map.values();
        setImmediate(this.#cleanIterate.bind(EventProxy));
    }

    static once(target, eventName, ref, method) {
        const symbol = Symbol();
        const listener = EventProxy.proxy.bind(EventProxy, symbol);
        target.once(eventName, listener);
        this.#map.set(symbol, [symbol, target, eventName, listener, ref, method]);
        this.#added++;
        if (this.#added > 100) this.#clean();
        return symbol;
    }

    static off(symbol) {
        const [storedSymbol, target, eventName, listener] = this.#map.get(symbol);
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

    static get lastCleaned() {
        return this.#lastCleaned;
    }

    static get timeMultiplier() {
        return this.#timeMultiplier;
    }

    static set timeMultiplier(value) {
        this.#timeMultiplier = value;
    }

    static get addSpeed() {
        return this.#addSpeed;
    }
}

export default EventProxy;