export class DataSmoother {
    constructor(bufferSize = 5) {
        this.bufferSize = bufferSize;
        this.data = [];
    }

    // Add a new reading and drop the oldest one
    add(value) {
        this.data.push(value);
        if (this.data.length > this.bufferSize) {
            this.data.shift();
        }
    }

    // Calculate the current average
    getAverage() {
        if (this.data.length == 0) return 0;
        const sum = this.data.reduce((a, b) => a + b, 0);
        return sum / this.data.length;
    }

    isReady() {
        return this.data.length === this.bufferSize;
    }
}