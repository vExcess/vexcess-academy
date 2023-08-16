// set program title
let programTitleEl = $("#program-title").$("*span")[0];
let editTitleBtn = $("#edit-title-btn");
function setProgramTitle (title) {
    programData.title = title;
    programTitleEl.text(title);
}
setProgramTitle(programData.title);
editTitleBtn.on("click", () => {
    let title = window.prompt("Enter a new title:", "New Program");
    if (title.length === 0) title = "New Program";
    setProgramTitle(title);
});

// the editor settings
let editorSettings = {
    width: programData.width,
    height: programData.height,
    indentSize: 4,
    fontSize: 13,
    theme: "vs-dark",
    wrap: true
};

// editor tabs container
let editorTabsContainer = $("#editor-tabs-container");
// the editor container
let editorContainer = $("#editor-container");
// the editor div itself
let editorDiv = $("#editor");
// create output frame
let outputFrame = $("iframe");
// the settings button
let settingsButtonEl = $("#editor-settings-button");
// the run button
let runButtonEL = $("#editor-run-button");
// the save button
let saveButtonEL = $("#editor-save-button");
// the delete button
let deleteButtonEL = $("#delete-program-button");
// new file tab button
let newTabBtn = $("#editor-newtab-btn");
// the settings element
let settingsEl = $("#editor-settings");
// the darkening element
let pageDarkenEl = $("#page-darken");
// auto refresh slider
let autoRefreshEl = $(".switch")[0].$("*input")[0];

let autoRefresh = localStorage.getItem("auto_refresh_editor") === "true" ? true : false;
autoRefreshEl.checked = autoRefresh;
autoRefreshEl.on("change", () => {
    autoRefresh = autoRefreshEl.checked;
    localStorage.setItem("auto_refresh_editor", autoRefresh.toString());
});

// models and stuff
const models = {};
let fileNames = programData.fileNames;
let currFileName, currModel;
let editor = null;

// setup output frame sandbox
outputFrame.attr({
    sandbox: "allow-pointer-lock allow-same-origin allow-scripts allow-popups allow-modals allow-forms",
    width: editorSettings.width,
    height: editorSettings.height
}).css({
    backgroundColor: "white",
    border: "1px solid rgb(200, 200, 200)",
    marginLeft: "auto",
    order: "2"
});
editorContainer.$("*div")[1].replaceChild(outputFrame, $("#output-frame"));

// display loading icon
let outputFrameBox = outputFrame.getBoundingClientRect();
let loadIcon = loadIconManager.new(200);
loadIcon.css({
    position: "absolute",
    left: (outputFrameBox.left + outputFrameBox.right) / 2 - loadIcon.width / 2 + "px",
    top: (outputFrameBox.bottom + outputFrameBox.top) / 2 - loadIcon.height / 2 + window.scrollY + "px"
});
editorContainer.append(loadIcon);

let expectingSave = false;
function saveProgram() {
    programData.files[currFileName] = editor.getValue();

    if (!userData) {
        alert("You must be logged in to save a program");
        return;
    }

    var check = validateProgramData(programData);
    if (check !== "OK") {
        alert(check);
        return;
    }

    window.removeEventListener('beforeunload', confirmLeavePageFxn);
    confirmLeavePageFxn = null;

    if (programData.id) {
        saveButtonEL.$("*span")[0].text("Saving...");
        saveButtonEL.disabled = true;
        
        fetch("/API/save_program", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                id: programData.id,
                title: programData.title,
                width: editorSettings.width,
                height: editorSettings.height,
                files: programData.files,
                img: programData.img
            })
        }).then(res => res.text()).then(function (res) {
            if (res.includes("error")) {
                alert(res);
            } else {
                saveButtonEL.$("*span")[0].text("Saved!");
            }
        });
        setTimeout(() => {
            saveButtonEL.$("*span")[0].text("Save");
            saveButtonEL.disabled = false;
        }, 5000);
    } else {
        fetch("/API/create_program", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title: programData.title,
                type: programData.type,
                width: editorSettings.width,
                height: editorSettings.height,
                files: programData.files,
                img: programData.img
            })
        }).then(res => res.text()).then(function (res) {
            if (res.includes("error")) {
                alert(res);
            } else {
                window.location.href = "/computer-programming/" + res;
            }
        });
    }
}

// listen for thumbnail events
window.addEventListener("message", event => {
    let data = event.data;

    if (typeof data === "object" && data.sender === "sandbox") {
        if (loadIcon !== null) {
            loadIconManager.delete(loadIcon);
            loadIcon = null;
        }

        if (data.event === "thumbnail") {
            programData.img = data.img;

            if (expectingSave) {
                saveProgram();
                expectingSave = false;
            }
        }
    }
});

// the output window
let ifrWin = outputFrame.contentWindow || outputFrame.window;

// run the program once the environment loads
let outputFrameLoaded = false;
outputFrame.on("load", () => {
    outputFrameLoaded = true;
    loadIconManager.delete(loadIcon);
    loadIcon = null;
});

function isOverflown(element) {
    return element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
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
            return "can't contain /\\:*?\"<>|";
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

        // limit size
        if (data.width < 400 || data.height < 400) {
            return e + "project dimensions can't be less than 400";
        }
        if (data.width > 16384 || data.height > 16384) {
            return e + "project dimensions can't be larger than 16384";
        }

        if (typeof data.img === "string" || typeof data.img === "undefined") {
            // validate thumbnail type
            if (!(
                data.img.startsWith("data:image/jpg;base64,") ||
                data.img.startsWith("data:image/jpeg;base64,") ||
                data.img.startsWith("data:image/jfif;base64,")
            )) {
                return e + "project thumbnail must be a jpg/jpeg/jfif";
            }
            // validate thumbnail size to 128 KB
            if (data.img.length > 128 * 1024) {
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

function getFile (name)  {
    return programData.files[name];
}
function setFile (name, data)  {
    return programData.files[name] = data;
}

let confirmLeavePageFxn = null;
function confirmLeavePage () {
    if (confirmLeavePageFxn === null) {
        confirmLeavePageFxn = e => {
            e.preventDefault();
            e.returnValue = '';
        };
        
        window.addEventListener('beforeunload', confirmLeavePageFxn);
    }
}

function runProgram () {
    ifrWin.postMessage("ping", "*");
    
    var mainCode;
    switch (programData.type) {
        case "html":
            mainCode = getFile("index.html");
        break;
        case "pjs":
            mainCode = getFile("index.js");
        break;
        case "java":
            mainCode = getFile("Main.java");
        break;
        case "glsl":
            mainCode = getFile("image.glsl");
        break;
        case "c":
            mainCode = getFile("main.c");
        break;
        case "cpp":
            mainCode = getFile("main.cpp");
        break;
        case "python":
            mainCode = getFile("main.py");
        break;
        case "jitlang":
            mainCode = getFile("main.jitl");
        break;
    }

    if (mainCode === undefined) return;
    
    if (mainCode.includes("<title>") && mainCode.includes("<\/title>")) {
        setProgramTitle(mainCode.split("<title>")[1].split("<\/title>")[0]);
    }
    
    ifrWin.postMessage({
        width: editorSettings.width,
        height: editorSettings.height,
        files: programData.files
    }, "*");
}

function timeSince (date) {
    if (typeof date !== 'object') {
        date = new Date(date);
    }

    let seconds = Math.floor((new Date() - date) / 1000);
    let intervalType;

    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) {
        intervalType = 'year';
    } else {
        interval = Math.floor(seconds / 2592000);
        if (interval >= 1) {
            intervalType = 'month';
        } else {
            interval = Math.floor(seconds / 86400);
            if (interval >= 1) {
                intervalType = 'day';
            } else {
                interval = Math.floor(seconds / 3600);
                if (interval >= 1) {
                    intervalType = "hour";
                } else {
                    interval = Math.floor(seconds / 60);
                    if (interval >= 1) {
                        intervalType = "minute";
                    } else {
                        interval = seconds;
                        intervalType = "second";
                    }
                }
            }
        }
    }

    if (interval > 1 || interval === 0) {
        intervalType += 's';
    }

    return interval + ' ' + intervalType;
}

if (programData.id) {
    let authorLink = $("a")
        .css({
            textDecoration: "none",
            color: "rgb(0, 140, 60)"
        })
        .text(programData.author.nickname)
        .attr({
            target: "_blank",
            href: "/profile/id_" + programData.author.id
        });

    let programAuthorEl = $("#program-author")
        .html("Created By: ")
        .append(authorLink);
    programAuthorEl.innerHTML += " (Updated " + timeSince(programData.lastSaved - 30 * 1000) + " ago)";

    $("#program-hidden").text("Hidden: No");
    $("#program-created").text("Created: " + new Date(programData.created).toLocaleString('en-US', { timeZone: 'UTC' }));
    $("#program-updated").text("Updated: " + new Date(programData.lastSaved).toLocaleString('en-US', { timeZone: 'UTC' }));
}

if (programData.author) {
    if (!userData || (programData.author.id !== userData.id)) {
        $("#delete-program-button").remove();
        editTitleBtn.remove();
    }

    // like button stuff
    let likeProgramBtn = $("#like-program-button");
    
    // set like button content
    likeProgramBtn.$("*span")[0].text(userData && programData.hasLiked ? "Liked!" : "Like");
    likeProgramBtn.$("*span")[1].text(" · " + programData.likeCount);
    
    // handle like button click
    likeProgramBtn.on("click", () => {
        if (!userData) {
            alert("You must be logged in to like a program");
            return;
        }

        if (programData.hasLiked) {
            likeProgramBtn.$("*span")[0].text("Unliking...");
        } else {
            likeProgramBtn.$("*span")[0].text("Liking...");
        }
        likeProgramBtn.disabled = true;
        
        fetch("/API/like_program", {
            method: "POST",
            body: window.location.href.split("/")[4]
        }).then(res => res.text()).then(function (res) {
            if (res.includes("error")) {
                alert(res);
            } else if (res === "200") {
                if (programData.hasLiked) {
                    programData.likeCount--; // unlike the program
                    programData.hasLiked = false;
                } else {
                    programData.likeCount++; // like the program
                    programData.hasLiked = true;
                }
                
                // set like button content
                likeProgramBtn.$("*span")[0].text(userData && programData.hasLiked ? "Liked!" : "Like");
                likeProgramBtn.$("*span")[1].text(" · " + programData.likeCount);
            }
        });

        setTimeout(() => {
            likeProgramBtn.disabled = false;
        }, 5000);
    });

    // handle delete button click
    deleteButtonEL.on("click", () => {
        if (confirm("Are you sure you want to delete this project? This cannot be undone!") === true) {
            fetch("/API/delete_program", {
                method: "POST",
                body: window.location.href.split("/")[4]
            }).then(res => res.text()).then(function (res) {
                if (res.includes("error")) {
                    alert(res);
                } else {
                    window.location.href = "/computer-programming/";
                }
            });
        }
    });
} else {
    $("#like-program-button").remove();
    $("#delete-program-button").remove();
    $("#report-program-button").remove();
}

// about/forks/docs/guidelines tabs
let selectedTab = 0;
let tabs = $(".tab-tab");
let tabPages = $("#tab-content").$(".tab-page");

tabs[selectedTab].style.borderBottom = "5px solid rgb(31, 171, 84)";
tabPages[selectedTab].style.display = "block";

for (let i = 0; i < tabs.length; i++) {
    tabs[i].on("mouseenter", () => {
        if (i !== selectedTab) {
            tabs[i].style.borderBottom = "5px solid rgb(230, 230, 230)";
        }
    });
    tabs[i].on("mouseleave", () => {
        if (i !== selectedTab) {
            tabs[i].style.borderBottom = "5px solid transparent";
        }
    });
    tabs[i].on("click", () => {
        selectedTab = i;
        for (let j = 0; j < tabs.length; j++) {
            tabs[j].style.borderBottom = "5px solid transparent";
            tabPages[j].style.display = "none";
        }
        tabs[i].style.borderBottom = "5px solid rgb(31, 171, 84)";
        tabPages[i].style.display = "block";
    });
}

// to make the page responsive
function resizePage () {
    outputFrame.width = editorSettings.width;
    outputFrame.height = editorSettings.height;

    editorDiv.style.width = (window.innerWidth - (editorSettings.width + 41)) + "px";
    editorDiv.style.height = editorSettings.height + "px";
    editorContainer.style.height = editorSettings.height + 72 + "px";

    if (loadIcon) {
        outputFrameBox = outputFrame.getBoundingClientRect();
        loadIcon.css({
            left: (outputFrameBox.left + outputFrameBox.right) / 2 - loadIcon.width / 2 + "px",
            top: (outputFrameBox.bottom + outputFrameBox.top) / 2 - loadIcon.height / 2 + window.scrollY + "px"
        });
    }
}

// size the webpage
resizePage();

// resize if the window size is changed
window.addEventListener('resize', resizePage, true);

// Monaco setup
require.config({
   paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor/min/vs" }
});

// Monaco init
require(["vs/editor/editor.main"], () => {    
    function createModel (fileName) {
        let type = fileName.split(".").reverse()[0];
        
        switch (type) {
            case "js":
                type = "javascript";
            break;
            case "py":
                type = "python";
            break;
            case "txt":
                type = "plain";
            break;
            case "c":
                type = "c";
            break;
            case "glsl":
                type = "c";
            break;
            case "cpp":
                type = "cpp";
            case "jitl":
                type = "go";
            break;
        }

        let code = programData.files[fileName];

        // unescape code
        if (!code.includes("\n")) {
            if (code.indexOf('"') > code.indexOf("'")) {
                code = Function("return '" + code + "'")();
            } else {
                code = Function('return "' + code + '"')();
            }
        }
        
        let model = monaco.editor.createModel(code, type);

        model.updateOptions({
            tabSize: "4",
            fontSize: editorSettings.fontSize + "px",
            wrap : editorSettings.wrap,
            language: type
        });

        model.name = fileName;
        models[fileName] = model;

        model.onDidChangeContent(event => {
            programData.files[model.name] = model.getValue();
        });
    }

    // add auto completion to html
    monaco.languages.registerCompletionItemProvider('html', {
        triggerCharacters: ['>'],
        provideCompletionItems: (model, position) => {
            const codePre = model.getValueInRange({
                startLineNumber: position.lineNumber,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
            });
    
            const tag = codePre.match(/.*<(\w+)>$/)?.[1];
    
            if (!tag) return;
    
            const word = model.getWordUntilPosition(position);
    
            return {
                suggestions: [{
                    label: `</${tag}>`,
                    kind: monaco.languages.CompletionItemKind.EnumMember,
                    insertText: `$1</${tag}>`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn
                    }
                }]
            };
        },
    });

    // so people don't accidentaly exit and lose all their code
    editorDiv.on("keyup", confirmLeavePage);

    // the editor
    editor = monaco.editor.create(editorDiv.el, {
        automaticLayout: true
    });

    function updateCurrModel () {
        currModel = models[currFileName];
        editor.setModel(currModel);
    }

    // customize editor
    monaco.editor.setTheme("vs-dark");

    // run code live
    editor.onDidChangeModelContent(() => {
        if (autoRefresh) {
            if (!["java", "cpp"].includes(programData.type)) {
                runProgram();
            }
        }
    });

    let editorTabEls = [];
    const FileTab = $.createComponent("FileTab", $.html`
        <div class="editor-tab">
            <input class="editor-tab-input" type="text" value="\{filename}" data-filename="\{filename}" readonly="true" style="width: \{filename.length}ch">
            <span class="editor-tab-close">${String.fromCharCode(10006)}</span>
        </div>
    `, function() {
        let tabEl = this;
        
        tabEl.on("click", function() {
            let that = $(this);
            
            // save file
            programData.files[currFileName] = currModel.getValue();

            // change file
            currFileName = that.$(".editor-tab-input")[0].value;
            updateCurrModel();

            for (var i = 0; i < editorTabEls.length; i++) {
                editorTabEls[i].css("background-color: var(--fadedThemeColor)");
            }
            that.css("background-color: var(--themeColor)");
        });

        // the file name element
        tabEl.$(".editor-tab-input")[0]
            .on("input", function(e) {
                let that = $(this);
                
                let check = validateFileName(that.value);
                if (check !== "OK") {
                    e.preventDefault();
                    that.value = that.dataset.filename;
                    alert("file name " + check);
                } else {
                    let formerName = that.dataset.filename;
                    let newName = that.value;
                    
                    that.dataset.filename = newName;
    
                    // change file name/create new one if doesn't exist
                    var fileNameIdx = programData.fileNames.indexOf(formerName);
                    if (fileNameIdx === -1) fileNameIdx = programData.fileNames.length;
                    programData.fileNames[fileNameIdx] = newName;
                    
                    if (currFileName === formerName) currFileName = newName;
                    
                    programData.files[newName] = programData.files[formerName];
                    delete programData.files[formerName];
    
                    models[formerName].name = newName;
                    models[newName] = models[formerName];
                    delete models[formerName];
                }
                
                that.style.width = that.value.length + "ch";
            })
            .on("keyup", function(e) {
                if (e.key === "Enter") {
                    $(this).blur();
                }
            })
            .on("dblclick", function(e) {
                let that = $(this);
                if (that.readOnly === true) {
                    that.readOnly = false;
                    that.css("outline: 1px solid rgb(100, 100, 100)");
                }
            })
            .on("blur", function(e) {
                let that = $(this);
                that.readOnly = true;
                that.css("outline: none");
            });

        // the close button
        tabEl.$(".editor-tab-close")[0].on("click", function(e) {
            if (confirm("Are you sure you want to delete this file? This cannot be undone!") === true) {
                let fileName = tabEl.$(".editor-tab-input")[0].dataset.filename;
                
                let tabIdx = editorTabEls.indexOf(tabEl);
                editorTabEls.splice(tabIdx, 1);
                tabEl.remove();
    
                if (currFileName === fileName) {
                    var gotoIdx = tabIdx - 1 < 0 ? 0 : tabIdx - 1;
                    if (editorTabEls[gotoIdx]) {
                        editorTabEls[gotoIdx].click();
                    }
                }
    
                var fileNameIdx = programData.fileNames.indexOf(fileName);
                programData.fileNames.splice(fileNameIdx, 1);
                
                delete programData.files[fileName];
                delete models[fileName];
            }
    
            e.stopPropagation();
        });
    });
    
    
    function createFileTab (filename) {
        let tabEl = FileTab({ filename });

        // insert tab into editor
        newTabBtn.parentEl.insertBefore(tabEl, newTabBtn);
        editorTabEls.push(tabEl);

        if (isOverflown(editorTabsContainer)) {
            editorTabsContainer.css("margin-bottom: 0px");
        }

        return tabEl;
    }

    function startEditor() {
        // create models
        for (let fileName in programData.files) {
            createModel(fileName);
        }

        // create file tabs
        fileNames.sort();
        currFileName = fileNames[0];
        updateCurrModel();
        for (var f = 0; f < fileNames.length; f++) {
            let filename = fileNames[f];
            let file = getFile(filename);
            createFileTab(filename, file);
        }
        editorTabEls[0].css("background-color: var(--themeColor)");

        // set model value
        currModel.setValue(getFile(currFileName));

        updateCurrModel();
    }

    // load program if it's not a new program
    if (programData.id) {
        fetch(`/CDN/programs/${programData.id[0].toUpperCase()}/${programData.id}/f.json`).then(res => res.json()).then(json => {
            programData.files = json;

            const whitelist = [
                "cdn.jsdelivr.net",
                "cdnjs.cloudflare.com",
                "*.gstatic.com",
                "*.bootstrapcdn.com",
                "*.wikimedia.org",
                "*.kastatic.org",
                "*.khanacademy.org",
                "*.kasandbox.org",
                "github.com",
                "raw.githubusercontent.com",
            ];

            const urlRegex = /(?:(?:https?|ftp|file):\/\/|www\.|ftp\.)(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[-A-Z0-9+&@#\/%=~_|$?!:,.])*(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[A-Z0-9+&@#\/%=~_|$])/igm;
            const domains = [];
            
            for (let fileName in programData.files) {
                if (fileName.endsWith(".html") || fileName.endsWith(".js")) {
                    let found = programData.files[fileName].match(urlRegex);
                    if (found !== null) {
                        for (let i = 0; i < found.length; i++) {
                            let domName = found[i];
                            domName = domName.replace("http://", "").replace("https://", "");
                            let slashIdx = domName.indexOf("/");
                            if (slashIdx !== -1) {
                                domName = domName.slice(0, slashIdx);
                            }
                            domains.push(domName);
                        }
                    }
                }
            }

            if (programData.type === "pjs") {
                if (!domains.includes("*.kastatic.org")) {
                    domains.push("*.kastatic.org");
                }
                if (!domains.includes("*.kasandbox.org")) {
                    domains.push("*.kasandbox.org");
                }
            }
            
            outputFrame
                .attr("src", "https://sandbox.vexcess.repl.co/exec-" + programData.type + ".html?" + domains.map(btoa).join("&"))
                .on("load", () => {
                    startEditor();
                    runProgram();
                    outputFrameLoaded = true;
                });
        });
    
    } else {
        outputFrame
            .attr("src", "https://sandbox.vexcess.repl.co/exec-" + programData.type + ".html?allowAll=true")
            .on("load", () => {
                startEditor();
                runProgram();
                outputFrameLoaded = true;
            });
    }

    // settings stuff
    {
        // store the settings elements
        let settingsELs = {
            width: $("#canvasWidth"),
            height: $("#canvasHeight"),
            indentSize: $("#indentSize"),
            theme: $("#editorTheme"),
            fontSize: $("#fontSize"),
        };
        
        // initialize the settings values
        settingsELs.width.value = editorSettings.width;
        settingsELs.height.value = editorSettings.height;
        settingsELs.indentSize.value = editorSettings.indentSize;
        settingsELs.theme.value = editorSettings.theme;
        settingsELs.fontSize.value = editorSettings.fontSize;
        
        let settingsButtons = settingsEl.$(".button");
        
        // cancel button
        settingsButtons[0].on("click", () => {
            pageDarkenEl.style.display = "none";
            settingsEl.style.display = "none";
        
            settingsELs.width.value = editorSettings.width;
            settingsELs.height.value = editorSettings.height;
            settingsELs.indentSize.value = editorSettings.indentSize;
            settingsELs.theme.value = editorSettings.theme;
            settingsELs.fontSize.value = editorSettings.fontSize;
        });
        
        // save and close button
        settingsButtons[1].on("click", () => {
            pageDarkenEl.style.display = "none";
            settingsEl.style.display = "none";
        
            editorSettings.width = parseInt(settingsELs.width.value, 10);
            editorSettings.height = parseInt(settingsELs.height.value, 10);
            editorSettings.indentSize = parseInt(settingsELs.indentSize.value, 10);
            editorSettings.theme = settingsELs.theme.value;
            editorSettings.fontSize = parseInt(settingsELs.fontSize.value, 10);
        
            editor.getModel().updateOptions({
                tabSize: editorSettings.indentSize,
                fontSize: editorSettings.fontSize + "px",
            });
        
            monaco.editor.setTheme(editorSettings.theme);
            if (editorSettings.theme === "vs") {
                document.querySelector(':root').style.setProperty('--themeColor', 'rgb(230, 230, 230)');
                document.querySelector(':root').style.setProperty('--hoverThemeColor', 'rgb(220, 220, 220)');
                document.querySelector(':root').style.setProperty('--themeTextColor', 'rgb(0, 0, 0)');
            } else if (editorSettings.theme === "vs-dark") {
                document.querySelector(':root').style.setProperty('--themeColor', 'rgb(30, 30, 30)');
                document.querySelector(':root').style.setProperty('--hoverThemeColor', 'rgb(50, 50, 50)');
                document.querySelector(':root').style.setProperty('--themeTextColor', 'rgb(248, 248, 242)');
            }
        
            resizePage();
        
            runProgram();
        });
    }

    // handle editor button clicks
    settingsButtonEl.on("click", () => {
        pageDarkenEl.style.display = "block";
        settingsEl.style.display = "block";
    });
    
    runButtonEL.on("click", () => {
        runProgram();
    });
    
    saveButtonEL.on("click", () => {
        if (programData.author && userData && programData.author.id !== userData.id && userData.isAdmin) {
            let should = prompt("Type 'yes' to save as admin");
            if (should !== "yes") {
                return;
            }
        }
        ifrWin.postMessage("thumbnail", "*");
        expectingSave = true;
    });

    newTabBtn.on("click", () => {
        let fileName;
        let i = 0;
        while (programData.files["new (" + i + ").txt"]) {
            i++;
        }
        fileName = "new (" + i + ").txt";
        setFile(fileName, "");
        let tab = createFileTab(fileName);
        createModel(fileName);
        let nameEl = tab.$("*input")[0];
        nameEl.readOnly = false;
        nameEl.css("outline: 1px solid rgb(100, 100, 100)");
        nameEl.focus();
        nameEl.select();
    });
});