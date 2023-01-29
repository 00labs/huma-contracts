console.log("test");
// setTimeout(() => {
//     console.log("timeout");
// }, 1000);
// console.log("done");
const {EventEmitter} = require("stream");
const em = new EventEmitter();
em.on("data", (stream) => {
    console.log("data");
});
em.emit("data");
