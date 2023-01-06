async function sleep(ms, returnValue) {
    return new Promise((resolve) => {
        setTimeout(resolve.bind(undefined, returnValue), ms);
    });
}

export default sleep;