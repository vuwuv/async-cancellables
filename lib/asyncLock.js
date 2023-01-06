function AsyncLockTicket(lock, slotCount) {
    this.slotCount = slotCount;
    this.lock = lock;
    return Object.freeze(this);
}

class AsyncLock {
    #waiters = [];
    #usedSlots;
    #totalSlots;

    constructor(totalSlots = 1) {
        if (totalSlots < 1) throw new Error('Total slots must be 1 or more');
        if (!Number.isInteger(totalSlots)) throw new Error('totalSlots should be integer');
        this.#totalSlots = totalSlots;
        this.#usedSlots = 0;
    }

    get waitersPresent() {
        return this.#waiters.length > 0;
    }

    set totalSlots(value) {
        if (!Number.isInteger(value)) throw new Error('totalSlots should be integer');
        for (let item of this.#waiters)
            if (item[1] > value) throw new Error(`AsyncLock totalSlots (${item[1]}) can't be less then pending waiter slotCount (${value})`);
        this.#totalSlots = value;
    }

    get totalSlots() {
        return this.#totalSlots;
    }

    get usedSlots() {
        return this.#usedSlots;
    }

    get availableSlots() {
        return this.#totalSlots - this.#usedSlots;
    }

    release(ticket) {
        if (ticket.lock !== this) throw new Error('Ticket of a different lock object');
        this.#usedSlots -= ticket.slotCount;
        while (this.#waiters.length && this.#waiters[0][1] <= this.#totalSlots - this.#usedSlots) {
            let item = this.#waiters.shift();
            this.#usedSlots += item[1];
            item[0](item[3]);
        }
    }

    async #wait(slotCount, priority, cancellationToken = null) {
        if (!Number.isInteger(slotCount)) throw new Error('slotCount should be integer');
        if (slotCount > this.#totalSlots)
            throw new Error(`AsyncLock totalSlots (${this.#totalSlots}) can't be less then pending waiter slotCount (${slotCount})`);

        const ticket = new AsyncLockTicket(this, slotCount);
        const availableSlots = this.#totalSlots - this.#usedSlots;

        if (slotCount <= availableSlots && (this.#waiters.length === 0 || priority > this.#waiters[0][2])) {
            this.#usedSlots += slotCount;
            return ticket;
        } else {
            if (cancellationToken) cancellationToken.throwIfCancelled();

            const waiters = this.#waiters;

            let promise = new Promise((resolve, reject) => {
                const item = [resolve, slotCount, priority, ticket];

                if (cancellationToken) {
                    cancellationToken.processCancel(resolve, reject, () => {
                        let index = waiters.indexOf(item);
                        if (index >= 0) waiters.splice(index, 1);
                    });
                }

                let index = waiters.length - 1;
                while (index >= 0 && waiters[index][2] < priority) index--;

                waiters.splice(index + 1, 0, item);
            });

            return promise;
        }
    }

    async waitOne(cancellationToken = null) {
        return this.#wait(1, 0, cancellationToken);
    }

    async waitRegular(slotCount = 1, cancellationToken = null) {
        return this.#wait(slotCount, 0, cancellationToken);
    }

    async wait(slotCount = 1, priority = 0, cancellationToken = null) {
        return this.#wait(slotCount, priority, cancellationToken);
    }
}

export default AsyncLock;
