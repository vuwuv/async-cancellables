class AsyncCooldownQueue {
    #defaultCooldown;
    #queue = new Set();
    #last = 0;
    #timeout;
    #timeoutCallback = this.#completeTimeout.bind(this);

    constructor(defaultCooldown) {
        if (!Number.isInteger(defaultCooldown) || defaultCooldown <= 0) throw new Error('defaultCooldown should be integer greater than 0'); 
        this.#defaultCooldown = defaultCooldown;
    }
 
    #completeTimeout() {
        this.#timeout = null;
        const item = this.#queue.values().next().value;
        if (item) {
            item[1](true);
            this.#queue.delete(item);
            this.#last = performance.now();
        }
        this.#createTimeout(true);
    }

    #createTimeout(immediate = false) {
        if (!this.#timeout && this.#queue.size) {
            const item = this.#queue.values().next().value;
            this.#timeout = setTimeout(this.#timeoutCallback, immediate ? item[0] : this.#last - performance.now() + item[0]);
        }
    }

    #deleteItem(item) {
        const firstItem = this.#queue.values().next().value;
        if (this.#queue.delete(item)) {
            if (firstItem === item) {
                if (this.#timeout) clearTimeout(this.#timeout);
                this.#timeout = null;
                item = this.#queue.values().next().value;
                if (item) {
                    const now = performance.now();
                    if (now - this.#last >= item[0]) {
                        this.#last = now;
                        item[1](true);
                        this.#queue.delete(item);
                    }
                }
                this.#createTimeout();
            }
        }
    }

    async wait(ct = null) {
        return this.waitTime(this.#defaultCooldown, ct);        
    }

    async waitTime(cooldown, ct = null) {
        if (!Number.isInteger(cooldown) || cooldown <= 0) throw new Error('cooldown should be integer greater than 0'); 
        const now = performance.now();
        if (!this.#timeout && (this.#last === 0 || now - this.#last >= cooldown)) {
            this.#last = now;
            return true;
        }

        const item = [cooldown, null];
        const promise = new Promise((resolve, reject) => {
            item[1] = resolve;
            if (ct) [resolve, reject] = ct.processCancel(resolve, reject, this.#deleteItem.bind(this, item));
        });
        this.#queue.add(item);

        this.#createTimeout();

        return promise;
    }

    get waitersPresent() {
        return this.#queue.size > 0;
    }

    get waitersCount() {
        return this.#queue.size;
    }

    get timeUntilAvailable() {
        let result = Math.max(0, this.#last - performance.now());
        for (const item of this.#queue) result = item[0];
        return result;
    }
}

export default AsyncCooldownQueue;