import { createNoteRecordingGesture } from "../../../utils/media/note_recording_gesture.js";
import { VoiceNoteSession } from "../functions/voice_note_session.js";
import { updateStateButtons } from "../functions/update_state_buttons.js";
import type { Comments } from "../index.js";

/** Управление общей кнопкой голосового сообщения и видеокружка. */
export function voiceNotePointerHandler(form: Comments, element: HTMLElement): void {
    if (form.voiceNoteGestureController) return;
    form.voiceNoteGestureController = createNoteRecordingGesture(element, {
        getSession: video => {
            if (video) return form.videoNoteRecorder;
            return form.voiceNoteSession ??= new VoiceNoteSession(form);
        },
        isBusy: () => Boolean(form.voiceRecorder || form.voiceNoteSession?.isStarting
            || form.voiceNoteSession?.isStopping || form.videoNoteRecorder?.isStarting
            || form.videoNoteRecorder?.recorder.isRecording),
        cancelActive: async () => {
            await form.voiceNoteSession?.cancel();
            form.videoNoteRecorder?.cancel();
        },
        update: () => updateStateButtons(form)
    });
}
