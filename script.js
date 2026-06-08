const DELAY_BETWEEN_SYSEX = 100;

// --- GLOBAL APPLICATION STATE ---
function getSavedMemory() {
    try {
        const saved = localStorage.getItem('matrix2Memory');
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.error("Error reading local memory", e);
    }
    return Array(7).fill(null).map(() => Array(32).fill(null).map(() => new Array(16).fill(0)));
}

let memoryBank = getSavedMemory();
let routingState = new Array(16).fill(0); 
let midiAccess = null;
let midiOutPort = null;
let hardwareRevision = 'R.05'; 
let isDemoMode = false;
let isLiveMode = false;

const SYSEX_HEADER = [0xF0, 0x00, 0x20, 0x09, 0x00, 0x1F, 0x7E];

// --- INITIALIZE PORT SETUP INTERFACE ---
async function startMidiInitialization() {
    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });
        populateMidiPorts();
        midiAccess.onstatechange = populateMidiPorts;
    } catch (err) {
        console.warn("MIDI access request failed or rejected.", err);
        document.getElementById('btn-connect').disabled = true;
        document.getElementById('midi-setup').classList.add('hidden');
        document.getElementById('browser-warning').classList.remove('hidden');
    }
}

function populateMidiPorts() {
    const outSelect = document.getElementById('midi-out');
    const btnConnect = document.getElementById('btn-connect');
    
    const activeOutValue = outSelect.value;
    outSelect.innerHTML = '<option value="">Please Select</option>';

    for (const output of midiAccess.outputs.values()) {
        outSelect.add(new Option(output.name, output.id));
    }

    if (activeOutValue) outSelect.value = activeOutValue;

    const checkPortSelections = () => {
        btnConnect.disabled = (outSelect.value === "");
    };

    outSelect.addEventListener('change', checkPortSelections);
    checkPortSelections();
}

function launchEditorEnvironment() {
    document.getElementById('setup-header').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    const statusBar = document.getElementById('status-bar');
    if (isDemoMode) {
        statusBar.innerText = `Running in DEMO Mode (${hardwareRevision})`;
        statusBar.style.color = "#ff4444";
    } else {
        statusBar.innerText = `MIDI Connection active (${hardwareRevision})`;
        statusBar.style.color = "#00aa00";
    }

    const bankSelect = document.getElementById('bank-select');
    if(bankSelect.options.length === 0) {
        for (let i = 1; i <= 7; i++) bankSelect.add(new Option('Bank ' + i, i - 1));
        const presetSelect = document.getElementById('preset-select');
        for (let i = 1; i <= 32; i++) presetSelect.add(new Option('Preset ' + i, i - 1));
    }

    loadPresetToGrid();
    generateMatrixGrid();
}

// --- INTERNAL MEMORY & PRESET MANAGEMENT ---
function loadPresetToGrid() {
    const bank = parseInt(document.getElementById('bank-select').value, 10);
    const preset = parseInt(document.getElementById('preset-select').value, 10);
    routingState = [...memoryBank[bank][preset]];
    refreshMatrixVisuals();
}

function syncActiveStateToMemory() {
    const bank = parseInt(document.getElementById('bank-select').value, 10);
    const preset = parseInt(document.getElementById('preset-select').value, 10);
    memoryBank[bank][preset] = [...routingState];
    localStorage.setItem('matrix2Memory', JSON.stringify(memoryBank));
}

// --- EDITABLE LABELS LOGIC ---
function getSavedLabels() {
    const saved = localStorage.getItem('matrix2Labels');
    return saved ? JSON.parse(saved) : {};
}

function SaveLabel(labelId, newValue) {
    const labels = getSavedLabels();
    labels[labelId] = newValue;
    localStorage.setItem('matrix2Labels', JSON.stringify(labels));    
}

function makeHeaderEditable(headerElement) {
    headerElement.contentEditable = "true";
    headerElement.style.cursor = "text";

    headerElement.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault(); 
            this.blur();        
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            const selection = window.getSelection().toString();
            if (this.innerText.length >= 8 && selection === '') {
                e.preventDefault(); 
            }
        }
    });

    headerElement.addEventListener('paste', function(e) {
        e.preventDefault();
        const text = (e.originalEvent || e).clipboardData.getData('text/plain');
        const remainingSpace = 8 - this.innerText.length;
        if (remainingSpace > 0) {
            document.execCommand('insertText', false, text.substring(0, remainingSpace));
        }
    });

    headerElement.addEventListener('blur', function() {
        const newValue = this.innerText.trim();
        SaveLabel(this.id, newValue);
    });
}

// --- INTERFACE RENDERING ENGINE ---
function generateMatrixGrid() {
    const grid = document.getElementById('matrix-container');
    grid.innerHTML = '';
    const savedLabels = getSavedLabels();

    for (let row = 0; row <= 16; row++) {
        for (let col = 0; col <= 16; col++) {
            
            const isHardwareRestricted = (hardwareRevision === 'R.03' && col === 16);

            if (row === 0 && col === 0) {
                grid.appendChild(document.createElement('div'));
            } 
            else if (row === 0) {
                const label = document.createElement('div');
                label.id = `label-out-${col}`;
                label.className = 'axis-label top';
                
                if (isHardwareRestricted) {
                    label.innerText = "N/A";
                    label.style.color = "#555"; 
                } else {
                    label.innerText = savedLabels[label.id] || `OUT ${col}`;
                    makeHeaderEditable(label);
                }
                
                grid.appendChild(label);
            } 
            else if (col === 0) {
                const label = document.createElement('div');
                label.id = `label-in-${row}`;
                label.className = 'axis-label left';
                label.innerText = savedLabels[label.id] || `IN ${row}`;
                makeHeaderEditable(label);
                grid.appendChild(label);
            } 
            else {
                const inIdx = row;
                const outIdx = col;
                
                const ledButton = document.createElement('button');
                ledButton.className = 'cell';
                ledButton.dataset.in = inIdx;
                ledButton.dataset.out = outIdx;
                
                if (isHardwareRestricted) {
                    ledButton.disabled = true;
                    ledButton.title = "Not editable in Revision R.03";
                } else {
                    ledButton.onclick = () => handleCellToggle(inIdx, outIdx);
                    
                    ledButton.onmouseenter = () => {
                        document.getElementById(`label-in-${inIdx}`).classList.add('highlight');
                        document.getElementById(`label-out-${outIdx}`).classList.add('highlight');
                    };
                    ledButton.onmouseleave = () => {
                        document.getElementById(`label-in-${inIdx}`).classList.remove('highlight');
                        document.getElementById(`label-out-${outIdx}`).classList.remove('highlight');
                    };
                }

                grid.appendChild(ledButton);
            }
        }
    }
    refreshMatrixVisuals();
}

// --- CORE CONTROL INTERACTION LOGIC ---
function handleCellToggle(inNum, outNum) {
    const outIndex = outNum - 1;

    if (routingState[outIndex] === inNum) {
        routingState[outIndex] = 0;
    } else {
        routingState[outIndex] = inNum; 
    }

    syncActiveStateToMemory(); 
    refreshMatrixVisuals();

    if (isLiveMode) sendMatrixRoutingTable();
}

function refreshMatrixVisuals() {
    document.querySelectorAll('.cell').forEach(cell => {
        const inVal = parseInt(cell.dataset.in, 10);
        const outVal = parseInt(cell.dataset.out, 10);
        
        if (hardwareRevision === 'R.03' && outVal === 16) {
            cell.classList.remove('on');
        } else if (routingState[outVal - 1] === inVal) {
            cell.classList.add('on');
        } else {
            cell.classList.remove('on');
        }
    });
}

// --- OUTBOUND SYSEX & MIDI INTERFACES ---
function sendMatrixRoutingTable() {
    if (isDemoMode || !midiOutPort) return;
    const bank = parseInt(document.getElementById('bank-select').value, 10);
    const preset = parseInt(document.getElementById('preset-select').value, 10);

    // Create a clean data copy to prevent breaking volatile memory data sets
    let transmissionRouting = [...routingState];
    
    // Hard overwrite the 16th channel byte array element map to 0 if running R.03 architecture
    if (hardwareRevision === 'R.03') {
        transmissionRouting[15] = 0;
    }

    let messagePayload = [...SYSEX_HEADER, 0x01, bank, preset];
    messagePayload = messagePayload.concat(transmissionRouting);
    messagePayload.push(0xF7);

    midiOutPort.send(messagePayload);
}

function sendActiveBankChange() {
    if (isDemoMode || !midiOutPort) return;
    const bank = parseInt(document.getElementById('bank-select').value, 10);
    midiOutPort.send([...SYSEX_HEADER, 0x02, 0x00, bank, 0xF7]);
}

function sendActivePresetChange() {
    if (isDemoMode || !midiOutPort) return;
    const preset = parseInt(document.getElementById('preset-select').value, 10);
    midiOutPort.send([...SYSEX_HEADER, 0x02, 0x01, preset, 0xF7]);
}

// --- BULK TRANSMISSION HELPERS ---
function transmitSequence(sequence, onComplete, progressCallback) {
    let index = 0;
    const total = sequence.length;

    function next() {
        if (index >= total) {
            onComplete();
            return;
        }

        const { bank, preset } = sequence[index];
        let transmissionRouting = [...memoryBank[bank][preset]];
        
        if (hardwareRevision === 'R.03') {
            transmissionRouting[15] = 0;
        }

        let messagePayload = [...SYSEX_HEADER, 0x01, bank, preset];
        messagePayload = messagePayload.concat(transmissionRouting);
        messagePayload.push(0xF7);

        midiOutPort.send(messagePayload);

        index++;
        if (progressCallback) progressCallback(index, total);

        setTimeout(next, DELAY_BETWEEN_SYSEX);
    }
    next();
}

// --- BULK TRANSMISSION (SAVE ALL PRESETS) ---
function transmitAllPresets() {
    if (isDemoMode || !midiOutPort) {
        alert("Please connect to a valid MIDI Out port to transmit all presets.");
        return;
    }

    const btnSavePreset = document.getElementById('btn-save-preset');
    const btnSaveBank = document.getElementById('btn-save-bank');
    const btnSaveAll = document.getElementById('btn-save-all');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    
    btnSavePreset.disabled = true;
    btnSaveBank.disabled = true;
    btnSaveAll.disabled = true;
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';

    const sequence = [];
    for (let b = 0; b < 7; b++) {
        for (let p = 0; p < 32; p++) {
            sequence.push({ bank: b, preset: p });
        }
    }

    transmitSequence(
        sequence,
        () => {
            setTimeout(() => {
                btnSavePreset.disabled = false;
                btnSaveBank.disabled = false;
                btnSaveAll.disabled = false;
                progressContainer.classList.add('hidden');
            }, 500);
        },
        (current, total) => {
            progressBar.style.width = Math.round((current / total) * 100) + '%';
        }
    );
}

// --- BULK BANK TRANSMISSION (SAVE ACTIVE BANK) ---
function transmitActiveBank() {
    if (isDemoMode || !midiOutPort) {
        alert("Please connect to a valid MIDI Out port to transmit the bank.");
        return;
    }

    const bank = parseInt(document.getElementById('bank-select').value, 10);
    const btnSavePreset = document.getElementById('btn-save-preset');
    const btnSaveBank = document.getElementById('btn-save-bank');
    const btnSaveAll = document.getElementById('btn-save-all');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    
    btnSavePreset.disabled = true;
    btnSaveBank.disabled = true;
    btnSaveAll.disabled = true;
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';

    const sequence = [];
    for (let p = 0; p < 32; p++) {
        sequence.push({ bank: bank, preset: p });
    }

    transmitSequence(
        sequence,
        () => {
            setTimeout(() => {
                btnSaveBank.disabled = false;
                btnSaveAll.disabled = false;
                btnSavePreset.disabled = false;
                progressContainer.classList.add('hidden');
            }, 500);
        },
        (current, total) => {
            progressBar.style.width = Math.round((current / total) * 100) + '%';
        }
    );
}

// --- LOCAL FILE IMPORT/EXPORT (BULK DUMP) ---
document.getElementById('btn-dump-rx').addEventListener('click', () => {
    const exportData = {
        labels: getSavedLabels(),
        presets: memoryBank
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}_${String(now.getMonth() + 1).padStart(2, '0')}_${now.getFullYear()}`;
    
    a.href = url;
    a.download = `MATRIX_II_BULK_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

document.getElementById('btn-dump-tx').addEventListener('click', () => {
    document.getElementById('file-upload').click();
});

document.getElementById('file-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            
            if (data.labels) {
                localStorage.setItem('matrix2Labels', JSON.stringify(data.labels));
            }

            if (data.presets && Array.isArray(data.presets) && data.presets.length === 7) {
                memoryBank = data.presets;
                localStorage.setItem('matrix2Memory', JSON.stringify(memoryBank));
            }

            generateMatrixGrid();
            loadPresetToGrid();
            
            if (isLiveMode) {
                sendMatrixRoutingTable();
            }
            
        } catch (err) {
            alert("Read error. Please ensure this is a valid MATRIX II JSON file.");
            console.error(err);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; 
});

// --- EVENT TRACKER ATTACHMENTS ---
document.getElementById('btn-connect').addEventListener('click', () => {
    const outId = document.getElementById('midi-out').value;
    hardwareRevision = document.getElementById('revision-select').value;
    midiOutPort = midiAccess.outputs.get(outId);
    isDemoMode = false;
    launchEditorEnvironment();
});

document.getElementById('btn-demo').addEventListener('click', () => {
    hardwareRevision = document.getElementById('revision-select').value;
    midiOutPort = null;
    isDemoMode = true;
    launchEditorEnvironment();
});

document.getElementById('btn-clear').onclick = () => {
    routingState.fill(0);
    syncActiveStateToMemory();
    refreshMatrixVisuals();
    if (isLiveMode) sendMatrixRoutingTable();
};

document.getElementById('btn-live-mode').addEventListener('click', (e) => {
    isLiveMode = !isLiveMode;
    e.target.innerText = isLiveMode ? "Live Mode: ON" : "Live Mode: OFF";
    e.target.classList.toggle('active', isLiveMode);
    if (isLiveMode) {
        sendActiveBankChange();
        sendActivePresetChange();
        sendMatrixRoutingTable();
    }
});

document.getElementById('btn-save-preset').onclick = () => {
    sendMatrixRoutingTable();
};

document.getElementById('btn-save-bank').onclick = transmitActiveBank;

document.getElementById('btn-save-all').onclick = transmitAllPresets;

document.getElementById('bank-select').onchange = () => {
    loadPresetToGrid();
    if (isLiveMode) {
        sendActiveBankChange();
        sendMatrixRoutingTable();
    }
};

document.getElementById('preset-select').onchange = () => {
    loadPresetToGrid();
    if (isLiveMode) {
        sendActivePresetChange();
        sendMatrixRoutingTable();
    } 
};

startMidiInitialization();