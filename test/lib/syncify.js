function resolve(value) {
    this.value = value;
    this.complete = true;
    this.success = true;
}

function reject(error) {
    this.error = error;
    this.complete = true;
    this.success = false;
}

function syncify(promise) {
    if (Array.isArray(promise)) {
        const promises = promise;
        for (let i = 0; i < promise.length; i++) {
            const promise = promises[i];
            if (!(promise instanceof Promise)) throw new Error(`${promise} is not a Promise`);
            if (promise.complete === undefined) {
                promise.complete = false;
                promise.then(resolve.bind(promise), reject.bind(promise)); //.catch(reject.bind(promise));
            }
        }
    }
    else {
        if (!(promise instanceof Promise)) throw new Error(`${promise} is not a Promise`);
        if (promise.complete === undefined) {
            promise.complete = false;
            promise.then(resolve.bind(promise), reject.bind(promise)); //.catch(reject.bind(promise));
        }
    }

    return promise;
}

export default syncify;