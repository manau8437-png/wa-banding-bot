const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data');

// Inisialisasi folder
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });

class Database {
    constructor(filename) {
        this.filePath = path.join(DB_PATH, filename);
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({}));
        }
    }

    read() {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    }

    write(data) {
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    }

    get(key) {
        const db = this.read();
        return db[key] || null;
    }

    set(key, value) {
        const db = this.read();
        db[key] = value;
        this.write(db);
    }

    delete(key) {
        const db = this.read();
        delete db[key];
        this.write(db);
    }

    getAll() {
        return this.read();
    }

    query(filterFn) {
        const db = this.read();
        return Object.entries(db).filter(([key, val]) => filterFn(key, val));
    }
}

// Database instances
const userDB = new Database('users.json');
const emailDB = new Database('emails.json');
const limitDB = new Database('limits.json');

module.exports = { userDB, emailDB, limitDB, Database };
