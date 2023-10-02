console.log("Program Initiated!");

// For when I'm doing updates
const SERVER_DOWN = false;

// import dependencies
const http = require("node:https");
const fs = require("node:fs");
const crypto = require("node:crypto");
const Crypto_AES = require("crypto-js/aes");
const Crypto_SHA256 = require("crypto-js/sha256");
const Crypto_Base64 = require("crypto-js/enc-base64");
const Crypto_Utf8 = require("crypto-js/enc-utf8");
const { MongoClient } = require("mongodb");
const bson = require("bson");

// it'd be very bad if these were publicly available
const secrets = require("../secrets");
process.env.MASTER_KEY = secrets.MASTER_KEY;
process.env.RECAPTCHA_KEY = secrets.RECAPTCHA_KEY;

const myMongo = new MongoClient(secrets.databaseURL);
let db = null;
let users = null;
let programs = null;
let salts = null;

function SHA256(str) {
    return Crypto_Base64.stringify(Crypto_SHA256(str));
}
function AES_encrypt(txt, key) {
    let obj = Crypto_AES.encrypt(txt, key);
    return Crypto_Base64.stringify(obj.ciphertext) + "," + Crypto_Base64.stringify(obj.iv) + "," + Crypto_Base64.stringify(obj.salt);
}
function AES_decrypt(ctxt, key) {
    ctxt = ctxt.split(",");
    for (var i = 0; i < 3; i++) {
        ctxt[i] = Crypto_Base64.parse(ctxt[i]);
    }
    return Crypto_Utf8.stringify(Crypto_AES.decrypt({
        ciphertext: ctxt[0],
        iv: ctxt[1],
        salt: ctxt[2]
    }, key));
}

// some constants
const dontEscapeChars = " !#$%&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~";
const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const numbers = "0123456789";

// utilities
function random(start, stop) {
    if (!stop) {
        stop = start;
        start = 0;
    }
    return Math.random() * (stop - start) + start;
}
function genRandomToken(length) {
    const possibles = letters + numbers;
    const randVals = new Uint8Array(length);
    crypto.getRandomValues(randVals);
    
    let out = "";
    for (let i = 0; i < length; i++) {
        out += possibles[randVals[i] % possibles.length];
    }
    return out;
}

function sliceOut(str1, str2) {
    var idx = str1.indexOf(str2);
    return str1.slice(0, idx) + str1.slice(idx + str2.length, str1.length);
}

function parseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (err) {
        return null;
    }
}
function readJSON(path) {
    let data, res;
    try {
        data = fs.readFileSync(path, {
            encoding: "utf8"
        }).toString();

        res = JSON.parse(data);

        return res;
    } catch (err) {
        return null;
    }
}

function unicodeEscape(str, allowedChars) {
    allowedChars = allowedChars ?? "";
    let newStr = "";

    for (var i = 0; i < str.length; i++) {
        var c = str.charAt(i);
        newStr += allowedChars.includes(c) ? c : "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
    }

    return newStr;
}

function parseCookies(cookies) {
    return Object.fromEntries(cookies.split("; ").map(s => {
        var e = s.indexOf("=");
        return [s.slice(0, e), s.slice(e + 1, s.length)];
    }));
}

function parseQuery(url) {
    let quesIdx = url.indexOf("?");
    if (quesIdx === -1) {
        return {};
    } else {
        let end = url.slice(quesIdx + 1);
        if (end.length > 2) {
            let vars = end.split("&");
            let keys = {};
            for (var i = 0; i < vars.length; i++) {
                var eqIdx = vars[i].indexOf("=");
                vars[i] = [
                    decodeURIComponent(vars[i].slice(0, eqIdx)),
                    decodeURIComponent(vars[i].slice(eqIdx + 1))
                ];
                var number = Number(vars[i][1]);
                if (!Number.isNaN(number)) {
                    vars[i][1] = number;
                }
                keys[vars[i][0]] = vars[i][1];
            }
            return keys;
        } else {
            return {};
        }
    }
}

function escapeHTML(text) {
    var replacements = {
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "\"": "&quot;"
    };
    return text.replace(/[<>&"]/g, function(character) {
        return replacements[character];
    });
}

function calcStrSz(str) {
    var sz = 0;
    for (var i = 0; i < str.length; i++) {
        sz += str.charCodeAt(i) > 255 ? 2 : 1;
    }
    return sz;
}

function validateFileName(name) {
    var illegal = "/\\:*?\"<>|\n";
    if (name.length === 0) { // empty names are not allowed
        return "can't be empty";
    } else if (calcStrSz(name.length) >= 256) { // names can't be longer than 256 bytes
        return "must be less than 256 bytes";
    }
    if (name[0] === " " || name[0] === ".") { // names can't start with a period or space
        return "can't start with a period or space";
    }
    for (var i = 0; i < illegal.length; i++) {
        if (name.includes(illegal[i])) { // names can't contain illegal characters
            return "can't contain /\\:*?\"<>| or newline";
        }
    }
    return "OK";
}
function validateProgramData(data) {
    let e = "error: ";
    if (
        typeof data.files === "object" &&
        typeof data.width === "number" &&
        typeof data.height === "number" &&
        typeof data.title === "string"
    ) {
        // check if program is a valid type
        if (!["html", "pjs", "python", "glsl", "jitlang", "cpp", "java"].includes(data.type)) {
            return e + "invalid project type";
        }

        // validate forks
        if (data.parent && data.parent !== null && typeof data.parent !== "string") {
            return e + "invalid parent";
        }

        // limit size
        if (data.width % 1 !== 0 || data.height % 1 !== 0) {
            return e + "project dimensions must be integers";
        }
        if (data.width < 400 || data.height < 400) {
            return e + "project dimensions can't be less than 400";
        }
        if (data.width > 16384 || data.height > 16384) {
            return e + "project dimensions can't be larger than 16384";
        }

        if (data.thumbnail === null) {
            // do nothing
        } else if (typeof data.thumbnail === "string") {
            // validate thumbnail type
            if (!(
                data.thumbnail.startsWith("data:image/jpg;base64,") ||
                data.thumbnail.startsWith("data:image/jpeg;base64,") ||
                data.thumbnail.startsWith("data:image/jfif;base64,")
            )) {
                return e + "project thumbnail must be a jpg/jpeg/jfif";
            }
            // validate thumbnail size to 128 KB
            if (data.thumbnail.length > 128 * 1024) {
                return e + "project thumbnail is too big; 128 KB allowed";
            }
        } else if (typeof data.thumbnail === "object") {
            // validate thumbnail type
            if (!(
                data.thumbnail.buffer[0] === 0xFF &&
                data.thumbnail.buffer[1] === 0xD8 &&
                data.thumbnail.buffer[2] === 0xFF
            )) {
                return e + "project thumbnail must be a jpg/jpeg/jfif";
            }
            // validate thumbnail size to 128 KB
            if (data.thumbnail.length > 128 * 1024) {
                return e + "project thumbnail is too big; 128 KB allowed";
            }
        } else {
            return e + "project thumbnail is corrupted";
        }

        // validate title
        var checkTitle = validateFileName(data.title);
        if (checkTitle !== "OK") {
            return e + "project title " + checkTitle;
        }

        // 8 files allowed
        if (Object.keys(data.files).length > 8) {
            return e + "project has too many files; 8 allowed";
        }

        let projectSize = 0;
        for (var filename in data.files) {
            // validate file name
            var checkName = validateFileName(data.title);
            if (checkName !== "OK") {
                return e + "file name " + checkName;
            }

            // check if file data is valid
            var file = data.files[filename];
            if (typeof file !== "string") {
                return e + "project file data is corrupted";
            }

            // programs can't be bigger than 0.5 MB
            projectSize += calcStrSz(file.length);
            if (projectSize > 1024 * 512) {
                return e + "project is too big; 0.5 MB allowed";
            }
        }

        return "OK";
    } else {
        return e + "project metadata is corrupted";
    }
}
function validateNickname(nickname) {
    if (typeof nickname !== "string") {
        return "nickname must be a string";
    }
    if (nickname.length > 32) {
        return "nickname can't be longer than 32 characters";
    }
    if (nickname.length <= 0) {
        return "nickname can't be empty";
    }
    return "OK";
}
function validateBio(bio) {
    if (typeof bio !== "string") {
        return "bio must be a string";
    }
    if (bio.length > 160) {
        return "bio can't be longer than 160 characters";
    }
    return "OK";
}
function validateUsername(username) {
    if (typeof username !== "string") {
        return "username must be a string";
    }
    if (username.length > 32) {
        return "username can't be longer than 32 characters";
    }
    if (!(/^[a-zA-Z0-9\_]+$/.test(username))) {
        return "username can only contain letters, numbers, and underscores";
    }
    if (username.length < 3) {
        return "username can't be shorter than 3 characters";
    }
    return "OK";
}
function validatePassword(password) {
    if (typeof password !== "string") {
        return "password must be a string";
    }
    if (password.length > 64) {
        return "password can't be longer than 64 characters";
    }
    return "OK";
}

function calculateHotness(upvotes, uploadedOn) {
    // Constants for the Wilson Score Interval
    const z = 1.96; // 95% confidence interval
    
    // Calculate the fraction of upvotes
    const p = upvotes / (upvotes + 1); // Adding 1 to avoid division by zero
    
    // Calculate the "score"
    const score =
    (p + (z * z) / (2 * (upvotes + 1)) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * (upvotes + 1))) / (upvotes + 1))) /
    (1 + (z * z) / (upvotes + 1));
    
    // Calculate the hotness by considering the time elapsed
    const elapsedTime = (Date.now() - uploadedOn) / (1000 * 60 * 60); // Convert milliseconds to hours
    const hotness = score / elapsedTime;
    
    return hotness;
}


// for spam detection
const IP_monitor = readJSON("./ip-data.json") ?? {};
for (var ip in IP_monitor) {
    IP_monitor[ip].requests = 0;
}
// reset spam detection for IPs every minute
setInterval(function() {
    for (var ip in IP_monitor) {
        IP_monitor[ip].requests = 0;
    }
}, 1000 * 60 * 1);

// boilerplate code for new programs
const boilerplate = {
    html: `
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="utf-8">
                <title>New webpage</title>
                <link rel="stylesheet" href="./style.css">
            </head>
            <body>

                <script src="./index.js"></script>
            
            </body>
        </html>
    `,
    java: `
        class Main {
            public static void main(String[] args) {
                
            }
        }
    `,
    cpp: `
        #include <iostream>
        using namespace std;
        
        int main() {
            return 0;
        }
    `,
    glsl: `
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            // Normalized pixel coordinates (from 0 to 1)
            vec2 uv = fragCoord / iResolution.xy;
        
            // Time varying pixel color
            vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0,2,4));
        
            // Output to screen
            fragColor = vec4(col,1.0);
        }
    `
};

const DEFAULT_OG_TAGS = `
    <meta content="VExcess Academy" property="og:title" />
    <meta content="A website where anyone can learn to code and share their projects." property="og:description" />
    <meta content="/CDN/images/logo.png#a" property="og:image" />
`;

// clean up boilerplates
{
    let boilerplateKeys = Object.keys(boilerplate);
    let b, i, j, key, code, minIndent, lines;
    for (b = 0; b < boilerplateKeys.length; b++) {
        key = boilerplateKeys[b];
        code = boilerplate[key];
        minIndent = Infinity;
        lines = code.split("\n");
        lines = lines.slice(1, lines.length - 1);
        for (i = 0; i < lines.length; i++) {
            if (lines[i].trim().length > 0) {
                j = 0;
                while (lines[i][j] === " " && j < lines[i].length) {
                    j++;
                }
                if (j < minIndent) {
                    minIndent = j;
                }
            }
        }
        for (i = 0; i < lines.length; i++) {
            lines[i] = lines[i].slice(minIndent);
        }
        boilerplate[key] = lines.join("\n");
    }
}

class FileCache {
    files = new Map();
    readTimeStamps = new Map();
    mappings;
    cacheSize = 0;
    maxCacheSize;

    // cache size is in MB
    constructor(mappings, maxCacheSize) {
        this.mappings = mappings;
        this.maxCacheSize = maxCacheSize * 1024 * 1024;
    }

    get(name) {
        if (this.readTimeStamps.has(name)) {
            // update cache
            this.readTimeStamps.set(name, Date.now());
            return this.files.get(name);
        } else {
            let data = fs.readFileSync(this.mappings[name] ?? `./pages/${name}`, "utf8").toString();

            // update cache
            this.readTimeStamps.set(name, Date.now());
            this.files.set(name, data);

            // update cache size
            this.cacheSize += data.length;

            // while the cache is too big
            while (this.cacheSize > this.maxCacheSize) {
                const iterator = map1.entries();
                let oldestName;
                let oldestTimeStamp = Infinity;

                // find oldest file
                let entry;
                while (entry = iterator.next().value) {
                    if (entry[1] < oldestTimeStamp) {
                        oldestTimeStamp = entry[1];
                        oldestName = entry[0];
                    }
                }

                // update cache size
                this.cacheSize -= this.files.get(oldestName).length;
                
                this.readTimeStamps.delete(oldestName);
                this.files.delete(oldestName);
            }
            
            return data;
        }
    }

    clear() {
        this.readTimeStamps.clear();
        this.files.clear();
    }
}

// file cache for fast file serving
const fileCache = new FileCache({
    "main": "./page-template.html",
    "computer-programming": "./pages/computer-programming/computer-programming.html",
    "program": "./pages/computer-programming/program.html",
    "course": "./pages/computer-programming/course.html",
    "browse": "./pages/computer-programming/browse.html",
    "home": "./pages/home/home.html",
    "login": "./pages/login/login.html",
    "profile": "./pages/profile/profile.html",
    "logs/dev": "./pages/logs/dev.html",
    "tos": "./pages/tos/tos.html",
    "privacy-policy": "./pages/privacy-policy/privacy-policy.html",
}, 10);

// page creation utility
function createHTMLPage(pg, userData, openGraphTags) {
    return fileCache.get("main")
        .replace("<!-- OPEN GRAPH INSERT -->", openGraphTags)
        .replace("<!-- USER DATA INSERT -->", `<script>\n\tvar userData = ${userData ? JSON.stringify(userData).replaceAll("</", "<\\/") : "null"}\n</script>`)
        .replace("<!-- PAGE CONTENT INSERT -->", fileCache.get(pg));
}


// cache user credentials for fast authentification
const userCredentials = {};

// program caches for browse projects
let allPrograms = [];
let hotListData = [];
let recentListData = [];
let topListData = [];


// updates browse projects
async function updateProjectLists() {
    allPrograms = await programs.find({}).project({
        id: 1,
        type: 1,
        title: 1,
        likes: 1,
        forks: 1,
        created: 1,
        author: 1,
        code: 1,
        _id: 0
    }).toArray();

    hotListData = allPrograms.slice();
    recentListData = allPrograms.slice();
    topListData = allPrograms.slice();

    hotListData.sort((a, b) => calculateHotness(b.likes.length + b.forks.length * 2, b.created) - calculateHotness(a.likes.length + a.forks.length * 2, a.created));
    recentListData.sort((a, b) => b.created - a.created);
    topListData.sort((a, b) => b.likes.length - a.likes.length);

    // allPrograms.forEach(program => {
    //     // for manually editing all programs

    //     programs.updateOne({ id: program.id }, {$unset: {
    //         code: 1
    //     }});
    // });
}


// tree specifying the routes for the project
const projectTree = {
    "/clearCache": (path, out, data) => {
        fileCache.clear();
    },
    "/": (path, out, data) => {
        // main path
        out.writeHead(200, { 'Content-Type': 'text/html' });
        out.write(createHTMLPage("home", data.userData, DEFAULT_OG_TAGS));
    },
    "/login": (path, out, data) => {
        // login page
        out.writeHead(200, { 'Content-Type': 'text/html' });
        out.write(createHTMLPage("login", data.userData, DEFAULT_OG_TAGS));
    },
    "/profile/": (path, out, data) => {
        // profile page
        out.writeHead(200, { 'Content-Type': 'text/html' });
        out.write(createHTMLPage("profile", data.userData, DEFAULT_OG_TAGS));
    },
    "/logs/": (path, out, data) => {
        // logs path
        out.writeHead(200, { 'Content-Type': 'text/html' });
        out.write(createHTMLPage("logs/" + path, data.userData, DEFAULT_OG_TAGS));
    },
    "/tos": (path, out, data) => {
        // tos path
        out.writeHead(200, { 'Content-Type': 'text/html' });
        out.write(createHTMLPage("tos" + path, data.userData, DEFAULT_OG_TAGS));
    },
     "/privacy-policy": (path, out, data) => {
        // tos path
        out.writeHead(200, { 'Content-Type': 'text/html' });
        out.write(createHTMLPage("privacy-policy" + path, data.userData, DEFAULT_OG_TAGS));
    },
    "/computer-programming": (path, out, data) => {
        // computer programming home
        out.writeHead(200, { 'Content-Type': 'text/html' });
        out.write(createHTMLPage("computer-programming", data.userData, DEFAULT_OG_TAGS));
    },
    "/computer-programming/": {
        "browse": (path, out, data) => {
            // browse projects
            out.writeHead(200, { "Content-Type": "text/html" });
            out.write(createHTMLPage("browse", data.userData, DEFAULT_OG_TAGS));
        },
        "javascript": (path, out, data) => {
            // return course page
            out.writeHead(200, { 'Content-Type': 'text/html' });
            out.write(createHTMLPage("course", data.userData, DEFAULT_OG_TAGS));
            return;
        },
        "javascript/": (path, out, data) => {
            // return course page
            out.writeHead(200, { 'Content-Type': 'text/html' });
            out.write(createHTMLPage("course", data.userData, DEFAULT_OG_TAGS));
            return;
        },
        "webgl": (path, out, data) => {
            // return course page
            out.writeHead(200, { 'Content-Type': 'text/html' });
            out.write(createHTMLPage("course", data.userData, DEFAULT_OG_TAGS));
            return;
        },
        "webgl/": (path, out, data) => {
            // return course page
            out.writeHead(200, { 'Content-Type': 'text/html' });
            out.write(createHTMLPage("course", data.userData, DEFAULT_OG_TAGS));
            return;
        },
        "new/": (path, out, data) => {
            // new program path
            let programType = path;
            if (["webpage", "pjs", "python", "glsl", "jitlang", "cpp", "java"].includes(programType)) {
                let webpageCode = createHTMLPage("program", data.userData, DEFAULT_OG_TAGS);

                let programData = {
                    title: "New Program",
                    files: {},
                    fileNames: [],
                    width: 400,
                    height: 400
                };

                // setup files
                switch (programType) {
                    case "webpage":
                        programData.type = "html";
                        programData.fileNames = ["index.html", "index.js", "style.css"];
                        programData.files["index.html"] = unicodeEscape(boilerplate.html, dontEscapeChars);
                        programData.files["index.js"] = unicodeEscape("// JavaScript", dontEscapeChars);
                        programData.files["style.css"] = unicodeEscape("/* CSS */", dontEscapeChars);
                        break;
                        
                    case "pjs":
                        programData.type = "pjs";
                        programData.fileNames = ["index.js"];
                        programData.files["index.js"] = "// Processing.js";
                        break;

                    case "python":
                        programData.type = "python";
                        programData.fileNames = ["main.py"];
                        programData.files["main.py"] = "# Python";
                        break;

                    case "glsl":
                        programData.type = "glsl";
                        programData.fileNames = ["image.glsl"];
                        programData.files["image.glsl"] = boilerplate.glsl;
                        break;

                    case "jitlang":
                        programData.type = "jitlang";
                        programData.fileNames = ["main.jitl"];
                        programData.files["main.jitl"] = "// JITLang";
                        break;

                    case "cpp":
                        programData.type = "cpp";
                        programData.fileNames = ["main.cpp"];
                        programData.files["main.cpp"] = boilerplate.cpp;
                        break;

                    case "java":
                        programData.type = "java";
                        programData.fileNames = ["Main.java"];
                        programData.files["Main.java"] = boilerplate.java;
                        break;                    
                }

                // insert data into page
                webpageCode = webpageCode.replace(
                    "insert-page-data",
                    JSON.stringify({
                        programData: programData
                    }, "", "  ").replaceAll("\\\\u", "\\u")
                );

                out.writeHead(200, { 'Content-Type': 'text/html' });
                out.write(webpageCode);
            }
        },
        "*": async (path, out, data) => {
            try {
                // existing program path
                let programData = await programs.findOne({id: path}/*, {projection: {id: 1, _id: 0}}*/);
                
                if (programData === null) {
                    // exit if program
                    return out.write("500");
                } else {
                    // hide sensitive data from front end
                    programData.likeCount = programData.likes.length;
                    if (data.userData && programData.likes.includes(data.userData.id)) {
                        programData.hasLiked = true;
                    }
                    delete programData.likes;
                    
                    let webpageCode = createHTMLPage("program", data.userData, `
                        <meta content="${programData.title.replaceAll('"', '\\"')}" property="og:title" />
                        <meta content="Made by ${programData.author.nickname.replaceAll('"', '\\"')}" property="og:description" />
                        <meta content="/CDN/programs/${programData.id[0].toUpperCase()}/${programData.id}/i.jpg#a" property="og:image" />
                    `);
                    webpageCode = webpageCode.replace("insert-page-data", JSON.stringify({
                        programData: programData
                    }, "", "  ").replaceAll("</", "<\\/"));

                    out.writeHead(200, { "Content-Type": "text/html" });
                    out.write(webpageCode);
                }
            } catch (err) {
                console.log(err)
            }

        }
    },
    "/API/": {
        ":ACTION": (path, out, data) => {
            // yeet CORS :D
            out.setHeader("Access-Control-Allow-Origin", "*");

            // check if token is valid
            let hasPermission = data.userData !== null;

            return { hasPermission };
        },
        ":POST:": {
            "signup": async (path, out, data) => {
                // create account endpoint
                let json = parseJSON(data.postData);
                if (json === null) {
                    out.write("error");
                    return;
                }

                // validate input
                if (validateUsername(json.username) === "OK" && validatePassword(json.password) === "OK" && typeof json.recaptchaRes === "string") {
                    if (!IP_monitor[data.hashedUserIP].accounts) {
                        IP_monitor[data.hashedUserIP].accounts = [];
                    }

                    if (IP_monitor[data.hashedUserIP].accounts.length > 6) {
                        out.write("error: too many accounts associated with IP");
                        return;
                    }

                    for (let id in userCredentials) {
                        if (userCredentials[id].username.toLowerCase() === json.username.toLowerCase()) {
                            out.write("error: that username is already taken");
                            return;
                        }
                    }

                    let userId = genRandomToken(4) + Date.now().toString(36);
                    let userSalt = genRandomToken(16);
                    let userTok = genRandomToken(32);
                    /*
                        If the entire bitcoin community decided to try and focus all their computational
                        power into cracking a user token it would take 204528192898125370000 billion years
                    */

                    salts.insertOne({
                        id: userId,
                        salt: userSalt
                    });

                    let profile = {
                        nickname: json.username,
                        username: json.username,
                        avatar: "bobert",
                        password: SHA256(userSalt + json.password),
                        tokens: [Date.now(), AES_encrypt(userSalt + userTok, process.env.MASTER_KEY)],
                        id: userId,
                        bio: "",
                        created: Date.now(),
                        projects: [],
                        background: "blue"
                    };

                    let res = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_KEY}&response=${json.recaptchaRes}`, {
                        method: "POST"
                    });
                    let captcha = await res.json();
                    if (captcha.success) {
                        userCredentials[profile.id] = {
                            username: profile.username,
                            password: profile.password,
                            tokens: profile.tokens,
                            id: profile.id,
                            nickname: profile.nickname
                        };

                        IP_monitor[data.hashedUserIP].accounts.push(profile.id);

                        fs.writeFile("./ip-data.json", JSON.stringify(IP_monitor), err => {
                            if (err) {
                                console.log(err);
                            }
                        });

                        // log new user
                        console.log("ACCOUNT MADE", profile);

                        // save user to database
                        users.insertOne(profile);

                        // send user their auth token
                        out.write(userTok);
                    } else {
                        out.write("error: recaptcha failed");
                    }
                } else {
                    out.write("error: 400");
                    return;
                }
            },
            "login": async (path, out, data) => {
                // login endpoint
                if (data.userData) {
                    out.write("error: already signed in");
                    return;
                }

                let json = parseJSON(data.postData);
                if (json === null) {
                    out.write("error");
                    return;
                }

                if (validateUsername(json.username) === "OK" && validatePassword(json.password) === "OK") {
                    for (let id in userCredentials) {
                        let user = userCredentials[id];
                        if (user.username === json.username) {
                            let salt = (await salts.findOne({ id: user.id })).salt;

                            if (user.password === SHA256(salt + json.password)) {
                                let profile = await users.findOne({ id });
                                
                                // generate new auth token on every sign in
                                let userTok = genRandomToken(32);

                                // delete old tokens
                                let currTime = Date.now();
                                for (let i = 0; i < profile.tokens.length; i += 2) {
                                    if (currTime - profile.tokens[i] > 1000*60*60*24*7) {
                                        profile.tokens.splice(i, 2);
                                        userCredentials[id].tokens.splice(i, 2);
                                        i -= 2;
                                    }
                                }

                                // update cache
                                userCredentials[id].tokens.push(Date.now(), AES_encrypt(salt + userTok, process.env.MASTER_KEY));
                                
                                // update profile in storage
                                profile.tokens.push(Date.now(), AES_encrypt(salt + userTok, process.env.MASTER_KEY));
                                users.updateOne({ id }, {$set: {
                                    tokens: profile.tokens
                                }});
                                    
                                out.write(userTok);
                                return;
                            } else {
                                out.write("error: password is incorrect");
                                return;
                            }
                        }
                    }

                    out.write("error: that username doesn't exist");
                } else {
                    out.write("error: 400");
                    return;
                }
            },
            "create_program": async (path, out, data) => {
                // create program endpoint
                let json = parseJSON(data.postData);
                if (json === null) {
                    out.write("error");
                    return;
                }

                let programId;
                let creationError = false;

                if (!data.hasPermission) {
                    out.write("error: access denied");
                    return;
                }

                if (data.userData.projects.length > 32) {
                    out.write("error: your storage is full");
                    return;
                }

                // temp obj for program data
                var programData = {
                    id: null,
                    title: json.title,
                    type: json.type,
                    likes: [],
                    forks: [],
                    created: Date.now(),
                    lastSaved: Date.now(),
                    flags: [],
                    width: json.width,
                    height: json.height,
                    fileNames: Object.keys(json.files),
                    files: json.files,
                    author: {
                        username: data.userData.username,
                        id: data.userData.id,
                        nickname: data.userData.nickname
                    },
                    parent: json.parent ?? null,
                    thumbnail: json.thumbnail ? new bson.Binary(Buffer.from(json.thumbnail.slice(json.thumbnail.indexOf(",") + 1), 'base64')) : null
                };

                // validate input
                var programCheck = validateProgramData(programData);
                if (programCheck !== "OK") creationError = programCheck;

                // check if parent exists
                let parentProgram = null;
                if (programData.parent !== null && programData.parent.length > 0) {
                    parentProgram = await programs.findOne({id: programData.parent});
                    if (parentProgram === null) creationError = "error: parent non-existent";
                }

                if (!creationError) {
                    let directory;
                    do {
                        // create program id
                        programId = genRandomToken(6) + Date.now().toString(36);
                    } while (await programs.findOne({id: programId}) !== null); // check if program already exists

                    programData.id = programId;

                    // update parent forks array
                    if (parentProgram !== null) {
                        programs.updateOne({ id: programData.parent }, {$push: {
                            forks: {
                                id: programData.id,
                                created: programData.created,
                                likeCount: programData.likes.length
                            }
                        }});
                    }

                    // add program to user's profile
                    users.updateOne({ id: programData.author.id }, {$push: {
                        projects: programData.id
                    }});

                    // save program to database
                    programs.insertOne(programData);
                }

                // send program id to user
                if (creationError !== false) {
                    out.write(creationError);
                } else {
                    out.write(programId);
                }
            },
            "save_program": async (path, out, data) => {
                // save program endpoint
                let json = parseJSON(data.postData);
                if (json === null) {
                    out.write("error");
                    return;
                }

                let creationError = false;

                if (!data.userData || (!data.userData.projects.includes(json.id) && !data.userData.isAdmin)) {
                    data.hasPermission = false;
                }

                if (!data.hasPermission) {
                    out.write("error: access denied");
                    return;
                }

                // check if dir exists
                let programData = await programs.findOne({ id: json.id });
                if (programData === null) {
                    creationError = "error: program non-existent";
                }

                // temp obj for program data
                programData.title = json.title;
                programData.lastSaved = Date.now();
                programData.width = json.width;
                programData.height = json.height;
                programData.fileNames = Object.keys(json.files);
                programData.files = json.files;
                programData.thumbnail = json.thumbnail;

                // validate input
                let programCheck = validateProgramData(programData);
                if (programCheck !== "OK") creationError = programCheck;

                // update program in database
                if (!creationError) {
                    programs.updateOne({ id: json.id }, {$set: {
                        title: json.title,
                        lastSaved: Date.now(),
                        width: json.width,
                        height: json.height,
                        fileNames: Object.keys(json.files),
                        files: json.files,
                        thumbnail: json.thumbnail
                    }});
                }

                // send program id to user
                if (creationError !== false) {
                    out.write(creationError);
                } else {
                    out.write("OK");
                }
            },
            "delete_program": async (path, out, data) => {
                // delete program endpoint

                let programData = await programs.findOne({ id: data.postData });

                // check if program exists
                if (programData === null) {
                    out.write("error: program doesn't exist");
                    return;
                }

                // check if has permission to delete data
                try {
                    if (programData.author.id !== data.userData.id) {
                        data.hasPermission = false;
                    }
                } catch (e) {
                    out.write("error: error while deleting program");
                    return;
                }

                if (!data.hasPermission) {
                    out.write("error: access denied");
                    return;
                }

                // remove from parent forks array
                if (programData.parent !== null && programData.parent.length > 0) {
                    let parentData = await programs.findOne({ id: programData.parent });
                    if (parentData !== null) {
                        programs.updateOne({ id: programData.parent }, {$pull: {
                            forks: programData.id
                        }});
                    }
                }
                
                // remove program from user's profile
                users.updateOne({ id: data.userData.id }, {$pull: {
                    projects: data.postData
                }});

                // delete program from storage
                await programs.deleteOne({ id: data.postData });
                out.write("OK");
            },
            "like_program": async (path, out, data) => {
                // like program endpoint
                if (!data.hasPermission) {
                    out.write("error: access denied");
                    return;
                }

                try {
                    // get program data
                    let programData = await programs.findOne({ id: data.postData });

                    // update program data
                    if (!programData.likes.includes(data.userData.id)) {
                        programs.updateOne({ id: data.postData }, {$push: {
                            likes: data.userData.id
                        }});
                    } else {
                        programs.updateOne({ id: data.postData }, {$pull: {
                            likes: data.userData.id
                        }});
                    }

                    // update parent forks array
                    if (programData.parent !== null && programData.parent.length > 0) {
                        // parent directory path
                        let parentProgram = await programs.findOne({ id: programData.parent });
                        if (parentProgram !== null) {
                            for (let i = 0; i < parentProgram.forks.length; i++) {
                                let fork = parentProgram.forks[i];
                                if (fork.id === programData.id) {
                                    fork.likeCount = programData.likes.length;
                                }
                            }

                            programs.updateOne({ id: programData.parent }, {$set: {
                                forks: parentProgram.forks
                            }});
                        }
                    }
                    out.write("200");
                    return;
                } catch (e) {
                    out.write("error: error while liking program");
                    return;
                }
            },
            "update_profile": async (path, out, data) => {
                // change nickname endpoint
                let json = parseJSON(data.postData);
                if (json === null) {
                    out.write("error");
                    return;
                }

                if (!data.hasPermission) {
                    out.write("error: access denied");
                    return;
                }

                const validAvatars = ["bobert-cool","bobert-pixelated","boberta","bobert-approved","bobert-chad","bobert-cringe","bobert-flexing","bobert-hacker","bobert-high","bobert-troll-nose","bobert-troll","bobert-wide","bobert","rock-thonk","floof1","floof2","floof3","floof4","floof5","pyro1","pyro2","pyro3","pyro4","pyro5"];
                const validBackgrounds = ["blue","cosmos","electric-blue","fbm","fractal-1","green","julia-rainbow","julia","magenta","photon-1","photon-2","transparent"];
                
                // validate input
                if (json.nickname && validateNickname(json.nickname) !== "OK") {
                    out.write("error: 400");
                    return;
                }
                if (json.username && validateUsername(json.username) !== "OK") {
                    out.write("error: 400");
                    return;
                }
                if (json.bio && validateBio(json.bio) !== "OK") {
                    out.write("error: 400");
                    return;
                }
                if (json.avatar && !validAvatars.includes(json.avatar)) {
                    out.write("error: 400");
                    return;
                }
                if (json.background && !validBackgrounds.includes(json.background)) {
                    out.write("error: 400");
                    return;
                }

                const id = data.userData.id;
                let updateQuery = {};

                // update info
                if (json.nickname) {
                    updateQuery.nickname = json.nickname;
                    userCredentials[id].nickname = json.nickname;
                }
                if (json.username) {
                    updateQuery.username = json.username;
                    userCredentials[id].username = json.username;
                }
                if (json.bio) {
                    updateQuery.bio = json.bio;
                }
                if (json.avatar) {
                    updateQuery.avatar = json.avatar;
                }
                if (json.background) {
                    updateQuery.background = json.background;
                }

                await users.updateOne({ id }, {$set: updateQuery});

                out.write("OK");
            },
            "compile_cpp": async (path, out, data) => {
                let escapedCode = encodeURIComponent(data.postData);
                let res = await fetch("https://wasmexplorer-service.herokuapp.com/service.php", {
                    "headers": {
                    "accept": "*/*",
                    "accept-language": "en-US,en;q=0.9",
                    "content-type": "application/x-www-form-urlencoded",
                    "prefer": "safe",
                    "sec-ch-ua": "\"Chromium\";v=\"116\", \"Not)A;Brand\";v=\"24\", \"Microsoft Edge\";v=\"116\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site"
                    },
                    "referrer": "https://mbebenita.github.io/",
                    "referrerPolicy": "strict-origin-when-cross-origin",
                    "body": "input=" + escapedCode + "&action=cpp2wast&options=-std%3Dc%2B%2B11%20-Os",
                    "method": "POST",
                    "mode": "cors",
                    "credentials": "omit"
                });
                let body = await res.text();
                out.write(body);
            },
            "sign_out": async (path, out, data) => {
                // sign out endpoint
                if (!data.hasPermission) {
                    out.write("error: access denied");
                    return;
                }

                // invalidate token
                let token = data.userToken;
                let id = data.userData.id;
                let profile = await users.findOne({ id });
                
                // delete old tokens
                let currTime = Date.now();
                for (let i = 0; i < profile.tokens.length; i += 2) {
                    let plainTok = AES_decrypt(profile.tokens[i + 1], process.env.MASTER_KEY).slice(16);
                    if (currTime - profile.tokens[i] > 1000*60*60*24*7 || plainTok === token) {
                        profile.tokens.splice(i, 2);
                        userCredentials[id].tokens.splice(i, 2);
                        i -= 2;
                    }
                }
                
                // update profile in storage
                users.updateOne({ id }, {$set: {
                    tokens: profile.tokens
                }});
 
                out.write("OK");
            },
        },
        ":GET:": {
            ":ACTION": (path, out, data) => {
                out.writeHead(200, { "Content-Type": "application/json" });
            },
            "projects?": (path, out, data) => {
                let query = parseQuery("?" + path);
                let sort = query.sort ?? "hot";
                let page = query.page ?? 0;

                let list;
                switch (sort) {
                    case "hot":
                        list = hotListData;
                        break;
                    case "recent":
                        list = recentListData;
                        break;
                    case "top":
                        list = topListData;
                        break;
                }

                page *= 16;
                out.write(JSON.stringify(list.slice(page, page + 16)));
            },
            "getUserData?": async (path, out, data) => {
                var who = parseQuery("?" + path).who;
                let foundUser = false;

                if (who !== undefined) {
                    let queryType = who.startsWith("id_") ? "id" : "username";

                    for (var id in userCredentials) {
                        let user = userCredentials[id];
                        if (
                            (queryType === "id" && "id_" + user.id === who) ||
                            (queryType === "username" && user.username === who)
                        ) {
                            who = user;
                            foundUser = true;
                        }
                    }
                }

                if (foundUser) {
                    out.write(JSON.stringify(await users.findOne({ id: who.id })));
                } else {
                    out.write("404 Not Found"); // user not found
                }
            },
        }
    },
    "/CDN/": async (path, out) => {
        // stop browsers from complaining about CORS issues
        out.setHeader("Access-Control-Allow-Origin", "*");

        // figure out the type of file
        let fileExt = path.split(".").reverse()[0];
        let fileType = "text";
        let fileSubType = "plain";

        if (["png", "ico", "svg", "jpg"].includes(fileExt)) fileType = "image";
        if (fileExt === "js") {
            fileSubType = "javascript";
        } else if (fileExt === "svg") {
            fileSubType = "svg+xml";
        } else {
            fileSubType = fileExt;
        }

        // tell client to cache stuff for 1 week
        if (path.includes("monaco-editor") || fileType === "image") {
            out.setHeader("Cache-Control", "public, max-age=" + (60 * 60 * 24 * 7));
        }

        let fetchPath = "./" + path;
        let dataOut = null;

        if (fetchPath.startsWith("./programs/")) {
            if (fetchPath.endsWith(".json")) {
                let id = fetchPath.slice("./programs/".length, fetchPath.length - ".json".length);
                let programData = await programs.findOne({ id });
                dataOut = JSON.stringify(programData);
            } else if (fetchPath.endsWith(".jpg")) {
                let id = fetchPath.slice("./programs/".length, fetchPath.length - ".jpg".length);
                let programData = await programs.findOne({ id });
                if (programData.thumbnail !== null) {
                    dataOut = programData.thumbnail.buffer;
                }
            }
        } else {
            dataOut = fs.readFileSync(fetchPath);
        }

        if (dataOut !== null) {
            // send file
            out.writeHead(200, { "Content-Type": fileType + "/" + fileSubType });
            out.write(dataOut);
        } else {
            out.write("404 Not Found");
        }
    }
};

async function useTree(path, tree, data, response) {
    let status = "404";
    try {
        for (let key in tree) {
            if (path === key || (key === "/" && path.length === 0)) {
                status = "200";
                await tree[key](path.slice(key.length), response, data);
            } else if (path.startsWith(key) && (key[key.length - 1] === "/" || key[key.length - 1] === "?") && key !== "/") {
                if (key === "/API/") {
                    if (tree[key][":ACTION"]) {
                        let newData = await tree[key][":ACTION"](path, response, data);
                        for (var prop in newData) {
                            data[prop] = newData[prop];
                        }
                    }
                    switch (data.request.method) {
                        case "POST": {
                            let postData = "";

                            data.request.on("data", chunk => {
                                postData += chunk;
                            });

                            data.request.on("end", async () => {
                                status = await useTree(path.slice(key.length), tree[key][":POST:"], {
                                    ...data,
                                    postData
                                }, response);
                                if (status === "404") response.write("404 Not Found");
                                response.end();
                            });

                            status = "pending";
                            break;
                        }
                        case "GET": {
                            status = useTree(path.slice(key.length), tree[key][":GET:"], data, response);
                            break;
                        }
                    }
                } else if (typeof tree[key] === "function") {
                    status = "200";
                    await tree[key](path.slice(key.length), response, data);
                } else {
                    status = useTree(path.slice(key.length), tree[key], data, response);
                }
            } else if (key[key.length - 1] === "*" && path.startsWith(key.slice(0, key.length - 1))) {
                status = "200";
                await tree[key](path, response, data);
            } else if (key === ":ACTION") {
                let newData = await tree[key](path, response, data);
                for (var prop in newData) {
                    data[prop] = newData[prop];
                }
            }
        }
    } catch (err) {
        console.log(err);
        status = "500";
    }
    return status;
}

const server = http.createServer({key: secrets.key, cert: secrets.cert}, async (request, response) => {
    // For when I'm editing the source code
    if (SERVER_DOWN) {
        response.write("Server down for maintenance");
        return response.end();
    }

    // proxy the sandbox domain to the sandbox server
    if (request.headers["host"].startsWith("sandbox.")) {
        let res = await fetch("http://127.0.0.1:" + secrets.sandboxPort + request.url);
        let buff = await res.arrayBuffer();
        response.writeHead(200, res.headers);
        response.write(Buffer.from(buff));
        response.end();
        return;
    }

    // detect spam
    let hashedUserIP;
    if (response.req.headers["x-forwarded-for"]) {
        hashedUserIP = SHA256(AES_encrypt(response.req.headers["x-forwarded-for"], process.env.MASTER_KEY));
    }
    if (!IP_monitor[hashedUserIP]) IP_monitor[hashedUserIP] = {};
    IP_monitor[hashedUserIP].requests++;
    if (IP_monitor[hashedUserIP] > 50) {
        response.write("You've been temporarily blocked from accessing this resource due to making too many requests");
        return response.end();
    }

    // do cookies stuff
    let cookies = request.headers.cookie,
        userToken = null,
        userData = null;
    if (cookies) {
        // get user token
        userToken = parseCookies(cookies).token;

        // find which user is making request
        for (let id in userCredentials) {
            let user = userCredentials[id];
            // check against all user tokens
            for (let i = 0; i < user.tokens.length; i += 2) {
                if (AES_decrypt(user.tokens[i + 1], process.env.MASTER_KEY).slice(16) === userToken) {
                    userData = await users.findOne({ id });
                }
            }
        }
    }

    try {
        // remove trailing slashes
        let url = request.url;
        if (url[url.length - 1] === "/") {
            url = url.slice(0, url.length - 1);
        }
        // prevent people from accessing upstream files
        url = url.replaceAll("../", "./").replaceAll("..\\", ".\\");

        // handle the request
        let status = await useTree(url, projectTree, { request, userData, userToken, hashedUserIP }, response);
        if (status === "404") response.write("404 Not Found");
        if (status === "500") response.write("500 Internal Server Error");
        if (status !== "pending") response.end();
    } catch (err) {
        console.log(err);
        response.write("500 Internal Server Error");
        response.end();
    }
});

async function main() {
    await myMongo.connect();
    
    db = myMongo.db("vxsacademy");
    users = db.collection("users");
    programs = db.collection("programs");
    salts = db.collection("salts");

    console.log("Connected to MongoDB!");

    // load user credentials
    {
        const arr = await users.find({}).project({
            nickname: 1,
            username: 1,
            password: 1,
            tokens: 1,
            id: 1,
            _id: 0
        }).toArray();
    
        for (let i = 0; i < arr.length; i++) {
            let user = arr[i];
            userCredentials[user.id] = user;
        }
    }
    
    // update browser projects the first time
    await updateProjectLists();

    // update browse projects every 10 minutes
    setInterval(updateProjectLists, 1000 * 60 * 10);

    // lets light this candle!
    server.listen(secrets.port, function() {
        console.log("HTTPS Server Online at https://127.0.0.1:" + secrets.port);
    });
}

main().catch(console.error);
