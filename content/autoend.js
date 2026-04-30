// ==================================================
// CYFOR Nucleus Enhancer — Auto End Date/Time
// Continuously updates the End_Date_Time__c field
// with the current date and time.
// ==================================================

Cyfor.autoEnd = {
    _intervalId: null,
    _indicatorEl: null,

    /**
     * Start or stop the auto-end feature based on config.
     */
    handleState() {
        if (Cyfor.config.enableAutoEnd) {
            this.start();
        } else {
            this.stop();
        }
    },

    /**
     * Start auto-updating the end date/time field.
     */
    start() {
        // Clear any existing interval first
        this.stop();

        // Run immediately, then on interval
        this._update();
        this._intervalId = Cyfor.cleanup.setInterval(() => this._update(), 1000);

        this._showIndicator();
    },

    /**
     * Stop auto-updating.
     */
    stop() {
        if (this._intervalId != null) {
            Cyfor.cleanup.clearInterval(this._intervalId);
            this._intervalId = null;
        }
        this._hideIndicator();
    },

    /**
     * Perform a single update: find the End_Date_Time__c fields
     * and set them to the current date and time.
     */
    _update() {
        if (Cyfor.utils.isContextInvalid()) {
            this.stop();
            return;
        }

        const inputs = Cyfor.utils.findInputsByNameDeep(
            document.body,
            'End_Date_Time__c'
        );

        // Salesforce renders date/time as two separate inputs
        if (inputs.length < 2) return;

        let dateInput = null;
        let timeInput = null;

        // Classify by role attribute
        for (const input of inputs) {
            if (input.getAttribute('role') === 'combobox') {
                timeInput = input;
            } else {
                dateInput = input;
            }
        }

        // Fallback to positional if role detection failed
        if (!dateInput) dateInput = inputs[0];
        if (!timeInput) timeInput = inputs[1];

        const now = new Date();
        const dateValue = now.toLocaleDateString('en-GB');
        const timeValue = now.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });

        Cyfor.utils.setFieldValue(dateInput, dateValue);
        Cyfor.utils.setFieldValue(timeInput, timeValue);
    },

    /**
     * Show the "Auto-End" indicator pill in the corner.
     */
    _showIndicator() {
        if (this._indicatorEl && document.body.contains(this._indicatorEl)) return;

        const el = document.createElement('div');
        el.id = 'cyfor-autoend-indicator';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-label', 'Auto End Date/Time is active');

        const dot = document.createElement('span');
        dot.className = 'cyfor-pulse-dot';
        dot.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.textContent = 'Auto-End';

        el.appendChild(dot);
        el.appendChild(label);
        el.title = 'Auto End Date/Time is active — updating every second';

        document.body.appendChild(el);
        this._indicatorEl = el;
    },

    /**
     * Hide the "Auto-End" indicator.
     */
    _hideIndicator() {
        if (this._indicatorEl) {
            this._indicatorEl.remove();
            this._indicatorEl = null;
        }
        // Also catch any orphaned indicator from previous lifecycle
        document.getElementById('cyfor-autoend-indicator')?.remove();
    },

    /**
     * Initialise: set up state listener and initial state.
     */
    init() {
        Cyfor.config.onChange.enableAutoEnd.push(() => this.handleState());
        this.handleState();

        // Ensure we stop on cleanup
        Cyfor.cleanup.register(() => this.stop());
    }
};