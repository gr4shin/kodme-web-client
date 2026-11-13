// Импортируем utils
import { Logger } from "../../../utils/logs/logger.js";
import { AudioRecorder } from "../../../utils/audio/voice_recorder.js";
import { buildLocalMediaMetadata } from "../../../utils/media/local_media_metadata.js";
import { Icons } from "../../../utils/icons.js";

// Импортируем functions
import { updateStateButtons } from "./update_state_buttons.js";
import { createDraftComment, getDraftComment, setDraftComment } from "./draft_comment.js";

// Импортируем handlers
import { createCommentHandler } from "../handlers/create_comment.js";

// Импортируем типы
import type { AttachmentsRaw } from "../../../utils/messages/attachments.js";
import type { CommentRecord } from "../types.js";
import type { Comments } from "../index.js";

/** Объект-мап вложений черновика (тот же тип, что хранит CommentRecord.attachments). */
type AttachmentsMap = Extract<AttachmentsRaw, Record<string, unknown>>;

/**
 * ***************************************************************************
 * VoiceNoteSession - класс-контроллер записи голосового комментария.
 * Управляет панелью записи: таймер, волна, пауза, отмена и отправка.
 *
 * Адаптация сессии из формы сообщений (voice_note_session.ts): черновиком
 * служит tempComment (черновик комментария), отправка идёт через
 * createCommentHandler, статуса набора у комментариев нет.
 * ***************************************************************************
 */
export class VoiceNoteSession {

    /** Форма, которой принадлежит сессия. */
    form: Comments;

    /** Панель записи. */
    panel: HTMLElement | null;

    /** Отображение таймера записи. */
    timerContent: HTMLElement | null;

    /** Контейнер живой волны. */
    waveContainer: HTMLElement | null;

    /** Кнопка паузы. */
    pauseBtn: HTMLElement | null;

    /** Футерная кнопка записи (во время записи — отмена). */
    recordBtn: HTMLElement | null;

    /** Рекордер голосового (создаётся при первом запуске). */
    recorder: AudioRecorder | null;

    /** Состояние асинхронного запуска (защита от двойного старта). */
    isStarting: boolean = false;

    /** Токен запуска: защита от отмены, которая может произойти до завершения getUserMedia. */
    startToken: number = 0;

    /** Состояние финализации записи (защита от параллельного stop). */
    isStopping: boolean = false;

    /** Токен финализации: защита от отмены во время stop() или расчёта waveform. */
    stopToken: number = 0;

    /**
     * ***************************************************************************
     * Конструктор сессии записи голосового.
     * @param form - Форма комментариев.
     * ***************************************************************************
     */
    constructor(form: Comments) {

        // Записываем форму
        this.form = form;

        // Кэшируем элементы панели записи (без шаблона панель не найдется —
        // поля остаются null и запись не стартует)
        const tpl = form.tpl;
        this.panel = tpl?.querySelector(":scope [data-voice-note-panel]") ?? null;
        this.timerContent = this.panel?.querySelector(":scope [data-voice-note-timer]") ?? null;
        this.waveContainer = this.panel?.querySelector(":scope [data-voice-note-wave]") ?? null;
        this.pauseBtn = this.panel?.querySelector(":scope [action-voice-note-pause]") ?? null;
        this.recordBtn = tpl?.querySelector(":scope >.footer [action-voice-recorder]") ?? null;

        // Рекордер создаётся при первом запуске
        this.recorder = null;

        // Состояние асинхронного запуска и токен для защиты от отмены,
        // которая может произойти до завершения getUserMedia.
        this.isStarting = false;
        this.startToken = 0;

        // Состояние финализации записи и токен для защиты от отмены,
        // которая может произойти во время stop() или расчёта waveform.
        this.isStopping = false;
        this.stopToken = 0;

        // Привязываем метод
        this.onTimeUpdate = this.onTimeUpdate.bind(this);

    }

    /**
     * ***************************************************************************
     * Старт записи голосового комментария.
     * @param options - Параметры записи.
     * @param [options.hold=false] - Запись в режиме «удержания» (панель без
     * активных кнопок, отпускание отправляет запись).
     * @returns Успешно ли началась запись.
     * ***************************************************************************
     */
    async start(options: { hold?: boolean } = {}): Promise<boolean> {

        // Если запись уже идёт или финализируется — игнорируем новый запуск.
        if (this.form.voiceRecorder || this.isStarting || this.isStopping) return false;

        const startToken = ++this.startToken;
        this.isStarting = true;

        try {

            // Создаём рекордер при первом обращении
            if (!this.recorder) {
                this.recorder = new AudioRecorder();
            }

            // Подписываемся на таймер записи
            this.recorder.onTimeUpdate = this.onTimeUpdate;

            // Старт записи (микрофон)
            await this.recorder.start();

            // Если запись отменили во время запуска, освобождаем уже
            // полученный поток и не показываем устаревшую панель.
            if (startToken !== this.startToken) {
                this._cleanupRecorder();
                return false;
            }

            // Активируем панель записи
            this._activateUI(options.hold === true);

            return true;

        } catch (error) {

            // После отмены состояние уже сброшено вызывающим кодом.
            // Не затираем его повторным UI-обновлением устаревшего запуска.
            if (startToken === this.startToken) {
                this._cleanupRecorder();
                this._resetUI();
                Logger.error(error);
            }

            return false;

        } finally {
            this.isStarting = false;
        }

    }

    /**
     * ***************************************************************************
     * Обработка тиков таймера записи.
     * @param time - Время в формате 00:00.
     * @returns void
     * ***************************************************************************
     */
    onTimeUpdate(time: string): void {

        // Показываем время на панели
        if (this.timerContent) this.timerContent.textContent = time;

    }

    /**
     * ***************************************************************************
     * Пауза/продолжение записи с обновлением иконки кнопки.
     * @returns void
     * ***************************************************************************
     */
    togglePause(): void {

        if (!this.recorder) return;

        if (this.recorder.isPaused) {
            this.recorder.resume();
            this._setPauseIcon("player-pause");
        } else {
            this.recorder.pause();
            this._setPauseIcon("player-play");
            this.panel?.classList.add("paused");
        }

    }

    /**
     * ***************************************************************************
     * Остановка записи и отправка голосового комментария (кнопка «Отправить»).
     *
     * После успешного создания вложения комментарий уходит на сервер сразу:
     * и кнопка на панели, и отпускание удержания означают «отправить сейчас».
     * @returns Promise<void>
     * ***************************************************************************
     */
    async stop(): Promise<void> {

        // Не запускаем вторую финализацию для той же записи.
        if (this.isStopping) return;

        // Получаем время записи
        const elapsed = this.recorder?.elapsedMs || 0;

        // Если запись слишком короткая — просто отменяем
        if (elapsed <= 1000) {
            await this.cancel();
            return;
        }

        // Если рекордер уже не активен, освобождаем ресурсы и UI, а не
        // оставляем панель в состоянии записи.
        if (!this.recorder?.isRecording) {
            await this.cancel();
            return;
        }

        const stopToken = ++this.stopToken;
        this.isStopping = true;
        let audioFile: File | null = null;

        try {

            try {
                audioFile = await this.recorder.stop();
            } catch (error) {
                Logger.error(error);
                return;
            }

            // Если запись отменили во время финализации, не создаём
            // вложение из уже устаревшего файла.
            if (stopToken !== this.stopToken) return;

            // Освобождаем микрофон и возвращаем кнопку в обычное состояние
            // до расчёта waveform.
            this._cleanupRecorder();
            this._resetUI();

            const attached = await this.createAttachment(audioFile, stopToken);

            // Вложение добавлено — отправляем черновик на сервер немедленно,
            // не дожидаясь повторного нажатия «Отправить» в футере.
            if (attached) await createCommentHandler(this.form);

        } catch (error) {
            Logger.error(error);
        } finally {

            try {
                // Если cancel() уже сбросил UI, старый stop не должен сбрасывать
                // его повторно или затрагивать следующую запись.
                if (stopToken === this.stopToken) {
                    this._cleanupRecorder();
                    this._resetUI();
                }
            } finally {
                // Состояние освобождаем даже если UI уже недоступен после
                // закрытия формы.
                this.isStopping = false;
            }

        }

    }

    /**
     * ***************************************************************************
     * Отмена записи без сохранения (кнопка «X» или свайп вверх).
     * @returns Promise<void>
     * ***************************************************************************
     */
    async cancel(): Promise<void> {

        // Инвалидируем запуск, который ещё может завершиться после запроса
        // разрешения микрофона.
        this.startToken++;

        // Инвалидируем финализацию, чтобы отменённая запись не создала
        // вложение после завершения stop() или расчёта waveform.
        this.stopToken++;

        this._cleanupRecorder();

        this._resetUI();

    }

    /**
     * ***************************************************************************
     * Освобождает ресурсы рекордера и поток микрофона.
     * @returns void
     * ***************************************************************************
     */
    _cleanupRecorder(): void {

        if (!this.recorder) return;

        // Убираем связь с таймером, чтобы он не обновлял закрытую панель.
        this.recorder.onTimeUpdate = null;

        try {
            this.recorder._cleanup?.();
        } catch (error) {
            Logger.error(error);
        }

    }

    /**
     * ***************************************************************************
     * Перевод панели в состояние «свайп вверх — отменить».
     * @param active - Включить или выключить состояние отмены.
     * @returns void
     * ***************************************************************************
     */
    setSlidingCancel(active: boolean): void {

        if (!this.panel) return;
        this.panel.classList.toggle("sliding-cancel", active === true);

    }

    /**
     * ***************************************************************************
     * Логика создания вложения голосового комментария.
     * @param audioFile - Готовый аудиофайл.
     * @param [stopToken] - Токен операции остановки.
     * @returns Добавлено ли вложение в черновик (true — черновик можно отправлять)
     * ***************************************************************************
     */
    async createAttachment(audioFile: File, stopToken?: number): Promise<boolean> {

        // Не запускаем дорогое декодирование, если форма уже закрыта.
        if (this.form.tpl?.isConnected === false) return false;

        // Собираем длительность, mime оригинала и осциллограмму одним
        // проходом медиа-процессора (ветка audio_note). Обложку не ищем:
        // у записи голоса её нет.
        const metadata = await buildLocalMediaMetadata(audioFile, {
            extra: { is_audio_note: true },
            withCover: false
        });

        // Отмена или закрытие формы во время обработки запрещает
        // создание устаревшего черновика. Перечитываем isConnected
        // после await: форма могла закрыться за время обработки; явная
        // аннотация boolean сбивает TS-сужение после первой проверки.
        if (stopToken !== undefined && stopToken !== this.stopToken) return false;
        const isConnected: boolean = this.form.tpl?.isConnected ?? true;
        if (!isConnected) return false;

        // Создаем вложение
        const attach: AttachmentsMap[string] = {
            _file: audioFile,
            size: audioFile.size,
            temp_id: crypto.randomUUID(),
            file_name: audioFile.name,
            name: audioFile.name,
            mime_type: audioFile.type,
            // Осциллограмма уже внутри метадаты (processMedia, ветка audio_note)
            metadata: metadata
        };

        // Ключ объект-мапа задаётся локально при создании вложения —
        // без него вложение не сохранить
        const tempId = attach.temp_id;
        if (tempId == null) return false;

        // Если черновик комментария уже есть — добавляем вложение в него
        const draft = getDraftComment(this.form);
        if (draft) {

            // invariant: черновик создаётся локально — вложения в нём объект-мап
            const attachments = draft.attachments as AttachmentsMap;
            attachments[tempId] = attach;
            setDraftComment(this.form, draft);
            updateStateButtons(this.form);
            return true;

        }

        // Черновика ещё нет — создаём по тексту из поля ввода
        const newDraft: CommentRecord = createDraftComment(
            this.form,
            this.form.textarea?.value ?? "",
            { [tempId]: attach },
            this.form.replyComment ? this.form.replyComment.id : null
        );

        setDraftComment(this.form, newDraft);

        // Переключаем кнопки на форме
        updateStateButtons(this.form);

        return true;

    }

    /**
     * ***************************************************************************
     * Активация панели при старте записи.
     * @param hold - Запись в режиме «удержания».
     * @returns void
     * ***************************************************************************
     */
    _activateUI(hold: boolean): void {

        // Помечаем форму, что запись идёт (для update_state_buttons)
        this.form.voiceRecorder = this;

        // Сбрасываем таймер и готовим волну
        if (this.timerContent) this.timerContent.textContent = "00:00";
        this._buildWaveform();

        // Переключаем состояния панели
        this.panel?.classList.remove("hidden");
        this.panel?.classList.toggle("hold-mode", hold === true);
        this.panel?.classList.remove("paused", "sliding-cancel");
        this._setPauseIcon("player-pause");

        // Кнопка микрофона остаётся на месте и становится кнопкой отмены.
        if (this.recordBtn) {
            this.recordBtn.classList.add("error");
            this.recordBtn.innerHTML = Icons.icon("microphone-off", { settings: { stroke: 3 } })?.outerHTML ?? "";
        }

        // Обновляем состояние кнопок футера
        updateStateButtons(this.form);

    }

    /** Закрепляет запись: отпускание больше не отправляет, доступны кнопки панели. */
    lock(): void {
        this.panel?.classList.remove("hold-mode", "sliding-cancel");
    }

    /**
     * ***************************************************************************
     * Сброс панели после остановки/отмены записи.
     * @returns void
     * ***************************************************************************
     */
    _resetUI(): void {

        // Снимаем активную запись с формы
        this.form.voiceRecorder = null;

        // Прячем панель и сбрасываем состояния
        this.panel?.classList.add("hidden");
        this.panel?.classList.remove("paused", "hold-mode", "sliding-cancel");
        this._setPauseIcon("player-pause");
        this._clearWaveform();

        // Возвращаем кнопку микрофона в обычное состояние.
        if (this.recordBtn) {
            this.recordBtn.classList.remove("error");
            this.recordBtn.innerHTML = Icons.icon("microphone")?.outerHTML ?? "";
        }

        // Обновляем состояние кнопок футера
        updateStateButtons(this.form);

    }

    /**
     * ***************************************************************************
     * Генерация полосок живой волны (один раз на сессию формы).
     * @returns void
     * ***************************************************************************
     */
    _buildWaveform(): void {

        if (!this.waveContainer) return;
        if (this.waveContainer.childElementCount > 0) return;

        // Генерируем полоски с разными высотами и сдвигом анимации
        for (let i = 0; i < 24; i++) {
            const bar = document.createElement("span");
            const height = 12 + Math.round(Math.abs(Math.sin(i * 0.9)) * 14);
            bar.style.height = `${height}px`;
            bar.style.animationDelay = `-${(i % 6) * 120}ms`;
            this.waveContainer.append(bar);
        }

    }

    /**
     * ***************************************************************************
     * Очистка полосок волны (чтобы анимация стартовала заново).
     * @returns void
     * ***************************************************************************
     */
    _clearWaveform(): void {

        if (this.waveContainer) this.waveContainer.innerHTML = "";

    }

    /**
     * ***************************************************************************
     * Установка иконки кнопки паузы.
     * @param iconName - Имя иконки ("player-pause" | "player-play").
     * @returns void
     * ***************************************************************************
     */
    _setPauseIcon(iconName: string): void {

        if (!this.pauseBtn) return;
        this.pauseBtn.innerHTML = Icons.icon(iconName, { settings: { filled: true } })?.outerHTML ?? "";

    }

}
