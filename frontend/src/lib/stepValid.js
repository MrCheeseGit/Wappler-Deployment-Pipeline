import { writable } from 'svelte/store';

// Each wizard step page sets this to true/false based on its own validation.
// WizardShell reads it to enable/disable the Next button.
export const stepValid = writable(false);
