class CustomSymbol {
    #symbol;

    constructor(symbol) {
        this.#symbol = symbol;
    }

    toString() {
        return `(${this.#symbol})`;
    }

    toJSON() {
        return this.toString();
    }
}

const Cancelled = new CustomSymbol('cancelled');
const Pending = new CustomSymbol('pending');
const Resolved = new CustomSymbol('resolved');

function isPromiseStatus(value) {
    return value === Cancelled || value === Pending || value === Resolved;
}

export { Cancelled, Pending, Resolved, isPromiseStatus };