function AsyncHybridLimitTicket(limit, slotCount, maxSlotCount) {
    this.slotCount = slotCount;
    this.maxSlotCount = maxSlotCount;
    this.limit = limit;
    return Object.freeze(this);
}

AsyncHybridLimitTicket.prototype.release = function () {
    this.limit.release(this);
}

class AsyncHybridLimit {
    #first = [null, null];  // first item of the linked list: 0 - occupied slots, 1 - waiters
    #last = [null, null];   // last item of the linked list: 0 - occupied slots, 1 - waiters
    #startSlot = null;      // slot to start searching for free slots from
    #ootStartSlot = null;   // out of turn start slot

    get waitersPresent() {
        return this.#first[1] !== null;
    }

    get waitersCount() {
        let count = 0, waiter = this.#first[1];
        while (waiter) {
            count++;
            waiter = waiter[1];
        }
        return count;
    }

    get waitersSlots() {
        let count = 0, waiter = this.#first[1];
        while (waiter) {
            count += waiter[3];
            waiter = waiter[1];
        }
        return count;
    }

    freeSlots(maxSlotCount) {
        return maxSlotCount - this.usedSlots(maxSlotCount);
    }

    usedSlots(maxSlotCount) {
        let slot = this.#first[0];
        if (!slot) return 0;
        const waiting = this.#last[1] ? Math.max(this.#last[1][7], this.#last[1][2]) : 0;
        if (waiting >= maxSlotCount) return maxSlotCount;
        while (slot) {
            if (slot[2] > maxSlotCount) return slot[4] + this.#calculateOverflow(slot, maxSlotCount);
            else if (slot[2] === maxSlotCount) return slot[4] + slot[5] + slot[3]
            slot = slot[1];
        }
        return Math.max(this.#last[0][3] + this.#last[0][4], waiting);
    }

    /*
        Inserts item before the anchor or to the start of the list (if no anchor is specified), where index specifies the index of the list.
    */
    #insertBefore(index, item, anchor) {
        if (!anchor) anchor = this.#first[index];

        if (anchor) {
            if (anchor[0]) anchor[0][1] = item;
            item[0] = anchor[0];
            item[1] = anchor;
            anchor[0] = item;
            if (!item[0]) this.#first[index] = item;
        }
        else {
            this.#first[index] = item;
            this.#last[index] = item;
            item[0] = null;
            item[1] = null;
        }

        return item;
    }

    /*
        Inserts item after the anchor or to the end of the list (if no anchor is specified), where index specifies the index of the list.
    */
    #insertAfter(index, item, anchor) {
        if (!anchor) anchor = this.#last[index];

        if (anchor) {
            if (anchor[1]) anchor[1][0] = item;
            item[1] = anchor[1];
            item[0] = anchor;
            anchor[1] = item;
            if (!item[1]) this.#last[index] = item;
        }
        else {
            this.#first[index] = item;
            this.#last[index] = item;
            item[0] = null;
            item[1] = null;
        }

        return item;
    }

    /*
        Removes the item from the list, where index specifies the index of the list.
    */
    #remove(index, item) {
        if (item[0]) item[0][1] = item[1];
        if (item[1]) item[1][0] = item[0];
        if (!item[0]) this.#first[index] = item[1];
        if (!item[1]) this.#last[index] = item[0];
    }

    /*
        Updates accumulator value for the slot item and all the items to the right
    */
    #updateAccumulator(slot, delta) {
        while (slot) {
            slot[4] += delta;
            slot = slot[1];
        }
    }

    /*
        Updates overflow value for all the items to the left
    */
    #updateOverflow(slot) {
        while (slot[0]) {
            let overflow = this.#calculateOverflow(slot);
            if (!overflow && !slot[0][5]) break;
            slot = slot[0];
            if (slot[5] !== overflow) slot[5] = overflow;
        }
    }

    /*
        Calculates how many slots current slot item needs from the prior slot item.
        (e.g. returns 1 if the slot item with maxSlotCount 5 uses 3 slots and the prior item has maxSlotCount 3)
    */
    #calculateOverflow(slot, to = 0) {
        const overflow = (to ? to : slot[0] ? slot[0][2] : 0) - slot[2] + slot[3] + slot[5];
        return overflow > 0 ? overflow : 0;
    }

    /*
        Checks if there are enough slots available for a waiter.
        If so, increases slots usage and returns true.
    */
    #tryUse(waiter, outOfTurn = false, startSlot = null) {
        let slot = startSlot || (outOfTurn ? this.#ootStartSlot : this.#startSlot) || this.#first[0];
        let ready = false;
        let freeSlots, usedSlots, overflow;
        const slotCount = waiter[3];
        const maxSlotCount = waiter[2];

        // position slot so its maxSlotCount is greater or equals to the waiter's maxSlotCount
        while (slot[0] && slot[0][2] >= maxSlotCount) slot = slot[0];
        while (slot && slot[2] < maxSlotCount) slot = slot[1];

        /*
            Slots use item structure
            previous[0]
            next[1]
            maxSlotCount[2]
            slotCount[3]    - slots used by the current item
            accumulator[4]  - total slots used in the items with lower maxSlotCount than the current one
            overflow[5]     - overflow use from the items with higher maxSlotCount
        */

        // if slot is found and waiter's maxSlotCount is not larger than the highest maxSlotCount in the slot usage list
        if (slot && slot[2] >= maxSlotCount) {
            overflow = this.#calculateOverflow(slot, maxSlotCount);
            usedSlots = slot[2] === maxSlotCount ? slot[3] + slot[4] + slot[5] : slot[4] + overflow;
            freeSlots = Math.min(maxSlotCount - usedSlots, maxSlotCount - waiter[7]);

            if (freeSlots >= slotCount) {
                ready = true;
                if (slot[2] === maxSlotCount) slot[3] += slotCount;
                else slot = this.#insertBefore(0, [null, null, maxSlotCount, slotCount, slot[4], overflow], slot);
            }
        }

        // if the waiter's maxSlotCount is larger than the highest maxSlotCount in the slot usage list
        if (slot === null) {
            slot = this.#last[0];
            freeSlots = Math.min(maxSlotCount - slot[4] - slot[3], maxSlotCount - waiter[7]);

            if (freeSlots >= slotCount) {
                ready = true;
                slot = this.#insertAfter(0, [null, null, maxSlotCount, slotCount, slot[3] + slot[4], 0]);
            }
        }

        if (ready) {
            this.#updateAccumulator(slot[1], slotCount);
            this.#updateOverflow(slot);
        }

        if (outOfTurn) this.#ootStartSlot = slot;
        else this.#startSlot = slot;

        return ready;
    }

    /*
        Frees slots associated with a ticket and checks if any waiters from the queue can use newly freed slots
    */
    release(ticket) {
        if (ticket.limit !== this) throw new Error('Ticket of a different limit object: ' + ticket.limit);
        const ticketMaxSlotCount = ticket.maxSlotCount, ticketSlotCount = ticket.slotCount;

        let slot = this.#first[0], releasedSlot = null;

        // find a slot use item with the matching maxSlotsCount and free used slotCount
        while (slot) {
            if (slot[2] === ticketMaxSlotCount) {
                if (slot[3] < ticketSlotCount) throw new Error(`Internal error: cannot find corresponding slots use for ${ticketMaxSlotCount}`);
                releasedSlot = slot;
                slot[3] -= ticketSlotCount;
                this.#updateAccumulator(slot[1], -ticketSlotCount);
                this.#updateOverflow(slot);
                break;
            }

            slot = slot[1];
        }

        if (!releasedSlot) throw new Error(`Internal error: cannot find corresponding slots use for ${ticketMaxSlotCount}`);

        let waiter = this.#first[1];
        this.#startSlot = this.#first[0];

        // iterate through waiters queue and find out if any of them can use currently free slots
        while (waiter) {
            if (waiter[2] > waiter[7]) {
                let ready = this.#tryUse(waiter);
                if (ready) {
                    this.#remove(1, waiter);
                    waiter[5](waiter[6]);
                }
            }
            waiter = waiter[1];
            if (waiter) waiter[7] = waiter[0] ? Math.max(waiter[0][7], waiter[0][2]) : 0;
        }

        // delete found slot item if it occupies 0 slots
        if (releasedSlot[3] === 0) {
            if (releasedSlot === this.#startSlot) this.#startSlot = null;
            this.#remove(0, releasedSlot);
        }
    }

    /*
        Removes the waiter from the queue, updates priorMaxSlotCount for waiters to the right, 
        checks if any of them can use slots due to having maxSlotCount higher than all the waiter before it.
    */
    async #exitQueue(waiter) {
        let next = waiter[1];
        this.#remove(1, waiter);
        if (next && waiter[2] > waiter[7]) {
            this.#ootStartSlot = null;
            let max = next[0] ? Math.max(next[0][2], next[0][7]) : 0;
            while (next && next[7] === waiter[2]) {
                next[7] = max;
                if (next[2] > max) {
                    let ready = this.#tryUse(next, true);
                    if (ready) {
                        this.#remove(1, next);
                        next[5](next[6]);
                    }
                    else if (next[2] > next[7]) max = next[2];
                }
                next = next[1];
            }
        }
    }

    /*
        Returns new ticket right away if there are free slots avaiable or puts waiter to the queue and returns a promise
    */
    async #wait(maxSlotCount, slotCount, priority, ct = null) {
        if (!Number.isInteger(maxSlotCount) || maxSlotCount < 1) throw new Error('maxSlotCount should be integer and greater than 0');
        if (!Number.isInteger(slotCount) || maxSlotCount < slotCount || slotCount < 1) throw new Error('slotCount should be integer and less or equal maxSlotCount and greater than 1');
        if (!Number.isFinite(priority)) throw new Error('priority should be number');

        let ready = false, waiter;

        /* 
        previous[0] - 
        next[1]
        maxSlotCount[2]
        slotCount[3]
        priority[4]
        resolve[5]
        ticket[6]
        priorMaxSlotCount[7] - the highest max slot count for waiters to the left of the current one
        */

        // 0 slots are currently used
        if (!this.#last[0]) {
            this.#insertBefore(0, [null, null, maxSlotCount, slotCount, 0, 0]);
            ready = true;
        }
        else {
            let anchor = this.#last[1];
            while (anchor && anchor[4] < priority) anchor = anchor[0];
            const max = anchor ? Math.max(anchor[7], anchor[2]) : 0

            const newWaiter = waiter = [null, null, maxSlotCount, slotCount, priority, null, null, max];

            if (maxSlotCount - max >= slotCount)
                ready = anchor === this.#last[1] ? this.#tryUse(waiter) : this.#tryUse(waiter, true, this.#first[0]);

            if (!ready) {
                anchor === null ? this.#insertBefore(1, waiter) : this.#insertAfter(1, waiter, anchor);
                while (waiter) {
                    if (waiter[0]) waiter[7] = Math.max(waiter[0][7], waiter[0][2]);
                    waiter = waiter[1];
                }
                waiter = newWaiter;
            }
        }

        const ticket = new AsyncHybridLimitTicket(this, slotCount, maxSlotCount);

        if (ready) return ticket;
        else {
            if (ct) ct.throwIfCancelled();

            let promise = new Promise((resolve, reject) => {
                if (ct) {
                    [resolve, reject] = ct.processCancel(resolve, reject, () => {
                        this.#exitQueue(waiter);
                    });
                }

                waiter[5] = resolve;
                waiter[6] = ticket;
            });

            return promise;
        }
    }

    async waitOne(maxSlotCount, ct = null) {
        return this.#wait(maxSlotCount, 1, 0, ct);
    }

    async wait(maxSlotCount, slotCount, ct = null) {
        return this.#wait(maxSlotCount, slotCount, 0, ct);
    }

    async waitPrioritized(maxSlotCount, slotCount, priority, ct = null) {
        return this.#wait(maxSlotCount, slotCount, priority, ct);
    }
}

export default AsyncHybridLimit;
export { AsyncHybridLimitTicket };
