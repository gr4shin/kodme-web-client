// Импортируем сторонние пакеты
import { OverlayScrollbars } from "overlayscrollbars";

// Импортируем config
import { CDM_FORM_CLASSES, CDM_FORM_HEADER_CLASSES, CDM_FORM_CONTENT_CLASSES } from "../../config/constants.js";

// Импортируем utils
import { Logger } from "../../utils/logs/logger.js";
import { Icons } from "../../utils/icons.js";
import { Store } from "../../utils/store.js";
import { LocalStorage } from "../../utils/local_storage.js";
import { SvgMaskManager } from "../../core/managers/svg_mask_manager.js";
import { TextareaAutosize } from "../../utils/helpers/textarea_autosize.js";
import { ScrollManager } from "../../core/managers/scroll_manager.js";
import { secretChatsTable } from "../../utils/secret_chats/secret_chats_db.js";

// Импортируем components
import { Overlay } from "../../components/overlay/index.js";
import { Avatars } from "../../components/avatars.js";
import { Buttons } from "../../components/buttons.js";
import { Inputs } from "../../components/inputs.js";

// Импортируем forms
import { Main } from "../main/index.js";
import { UserProfile } from "../user-profile/index.js";

// Импортируем handlers
import { onInputTextareaHandler } from "./handlers/on_input_textarea.js";
import { contextMenuHandler } from "./handlers/context_menu.js";
import { verifyChatHandler } from "./handlers/verify_chat.js";
import { startSecretCallHandler } from "./handlers/secret_call.js";
import { scrollDownHandler } from "./handlers/scroll_down.js";
import { emojiHandler } from "./handlers/emoji.js";
import { onContentScrollHandler } from "./handlers/on_content_scroll.js";
import { createMessageHandler } from "./handlers/create_message.js";
import { updateMessageHandler } from "./handlers/update_message.js";
import { cancelEditMessageHandler } from "./handlers/cancel_edit_message.js";
import { attachDocumentHandler } from "./handlers/attach_document.js";
import { textareaPasteBufferHandler } from "./handlers/textarea_paste_buffer.js";
import { dragAndDropFilesHandler } from "./handlers/drag_and_drop_files.js";
import { voiceNotePointerHandler } from "./handlers/voice_note_pointer.js";
import { stopVideoNoteHandler } from "./handlers/stop_video_note.js";
import { pauseResumeVideoNoteHandler } from "./handlers/pause_resume_video_note.js";
import { switchCameraVideoNoteHandler } from "./handlers/switch_camera_video_note.js";
import type { DragAndDropHandle } from "./handlers/drag_and_drop_files.js";

// Импортируем events
import { subscribeStoreEvents, unsubscribeStoreEvents } from "./events/store/store_events.js";
import { subscribeManagerEvents } from "./events/manager/manager_events.js";

// Импортируем functions
import { firstLoadMessages } from "./functions/first_load_messages.js";
import { intersection } from "./functions/intersection.js";
import { renderHeader } from "./functions/render_header.js";
import { TypingStatus } from "./functions/typing_status.js";
import { ReadReceiptsBatcher } from "./functions/read_receipts_batcher.js";
import { VoiceNoteSession } from "./functions/voice_note_session.js";
import { VideoNoteSession } from "./functions/video_note_session.js";

// Импортируем requests
import { getUserInfoRequest } from "../user-profile/requests/get_user_info.js";

// Импортируем functions (главная форма)
import { updateSecretChatRow } from "../main/functions/get_secret_chats.js";

// Импортируем типы
import type { GestureController } from "../../utils/gesture_controller.js";
import type { AvatarImageDocument } from "../../components/avatars.js";
import type { SecretConnectionState } from "../../utils/secret_chats/secret_connection.js";
import type { SecretChatRecord } from "../../types/secret_chats.js";
import type { SecretChatFormData, SecretChatFormOptions, SecretChatMessageRecord, SecretChatDirection } from "./types.js";
import { t } from "../../utils/i18n/index.js";

// Form
export class SecretChat {

    // Реестр всех открытых форм SecretChat: { chatId: instance }
    static instances = new Map<string, SecretChat>();

    /**
     * ***************************************************************************
     * Форма секретного чата.
     * @param data - Данные.
     * @param data.chatId - Id секретного чата.
     * @param data.options - Настройки формы.
     * @param data.options.insertInto - Куда вставить форму.
     * ***************************************************************************
     */
    constructor(data: SecretChatFormData) {

        // Если не передан chatId
        if (!data?.chatId) throw new Error("Не передан: chatId");

        // Устанавливаем настройки
        this.options = {
            insertInto: document.querySelector<HTMLElement>(".cdm-form.home .middle .form-container"),
            ...data?.options
        }

        // Каркас формы
        this.tpl = null;
        this.modal = null;
        this.svgMaskManager = null;
        this.content = null;
        this.list = null;
        this.editContainer = null;
        this.replyContainer = null;
        this.textarea = null;
        this.textareaAutosize = null;
        this.osListScrollInstance = null;                   // overlayScroll instance
        this.listScrollManager = null;                      // Менеджер скролла
        this.scrollDownBtn = null;
        this.name = null;
        this.subtitle = null;
        this.wrapFooter = null;
        this.avatar = null;

        // Состояние окна сообщений
        this.unreadMarkerBeforeId = null;                   // id сообщения, перед которым стоит маркер непрочитанных
        this.unreadMarkerObserver = null;                   // observer маркера непрочитанных
        this._lastInsertDirection = null;                   // направление последней вставки ("prev"/"next")

        // Планировщик синхронизации окна (обрезка/разделители/маркер)
        this._listSyncInit = false;
        this._listSyncScheduled = false;
        this._listSyncing = false;
        this._stickToBottom = false;                        // «дёрнуть список вниз» после синхронизации пачки

        // Переменные формы
        this.chatId = data.chatId;                          // ID секретного чата
        this.chat = null;                                   // данные чата (локальная запись)
        this.peerName = "";                                 // имя собеседника (шапка)
        this.peerAvatar = null;                             // аватар собеседника
        this.connectionState = null;                        // состояние P2P-соединения
        this.typingStatusText = null;                       // статус активности собеседника («печатает…»)
        this.observer = null;
        this.editedMessage = null;                          // редактируемое сообщение
        this.replyMessage = null;                           // сообщение на которое отвечаем
        this.tempMessage = null;                            // черновик (вложения до отправки)
        this.voiceRecorder = null;                          // сессия записи голосового (активна во время записи)
        this.voiceNoteSession = null;                       // постоянная сессия голосовых сообщений
        this.voiceNoteGestureController = null;             // контроллер жестов микрофона
        this.videoNoteRecorder = null;                      // видео рекордер

        // =====================
        this.isMessagesLoading = false;     // флаг подзагрузки сообщений
        this.isDropActive = false;          // флаг приёма перетаскиваемых файлов
        this.dragAndDrop = null;            // обработчики перетаскивания файлов
        // =====================

        // Подписки на события Store и менеджера
        this.storeUnsubs = [];
        this.managerUnsub = null;

        // Хранилище списка сообщений
        this.store = new Store<SecretChatMessageRecord>();

        // Инициализируем модуль статуса активности
        this.typingStatus = new TypingStatus(this);

        // Батчер квитанций «прочитано»: отправляем одним control-кадром
        // с задержкой, чтобы при быстром скролле не жечь канал
        this.readReceiptsBatcher = new ReadReceiptsBatcher(this);

        // Получаем instance
        let instance = SecretChat.instances.get(data.chatId);
        if (instance) return instance;

        // Регистрируем этот экземпляр формы
        SecretChat.instances.set(this.chatId, this);

        // Инициализация
        this._init();

    }

    // Настройки формы
    options: SecretChatFormOptions;

    // Каркас формы
    tpl: HTMLElement | null;
    modal: Overlay | null;
    svgMaskManager: SvgMaskManager | null;
    content: HTMLElement | null;
    list: HTMLElement | null;
    editContainer: HTMLElement | null;
    replyContainer: HTMLElement | null;
    textarea: HTMLTextAreaElement | null;
    textareaAutosize: TextareaAutosize | null;
    osListScrollInstance: OverlayScrollbars | null;
    listScrollManager: ScrollManager | null;
    scrollDownBtn: HTMLElement | null;
    name: HTMLElement | null;
    subtitle: HTMLElement | null;
    wrapFooter: HTMLElement | null;
    avatar: Avatars | null;

    // Состояние окна сообщений
    unreadMarkerBeforeId: string | null;
    unreadMarkerObserver: IntersectionObserver | null;
    _lastInsertDirection: SecretChatDirection | null;

    // Планировщик синхронизации окна
    _listSyncInit: boolean;
    _listSyncScheduled: boolean;
    _listSyncing: boolean;
    _scheduleListSync?: () => void;
    _stickToBottom: boolean;

    // Данные чата и собеседника
    chatId: string;
    chat: SecretChatRecord | null;
    peerName: string;
    peerAvatar: AvatarImageDocument | null;
    connectionState: SecretConnectionState | null;
    typingStatusText: string | null;

    // Сообщения
    observer: IntersectionObserver | null;
    editedMessage: SecretChatMessageRecord | null;
    replyMessage: SecretChatMessageRecord | null;
    tempMessage: SecretChatMessageRecord | null;

    // Сессии записи
    voiceRecorder: unknown;
    voiceNoteSession: VoiceNoteSession | null;
    voiceNoteGestureController: GestureController | null;
    videoNoteRecorder: VideoNoteSession | null;

    // Флаг подзагрузки сообщений (защита от параллельных запросов)
    isMessagesLoading: boolean;

    // Drag&drop вложений
    isDropActive: boolean;
    dragAndDrop: DragAndDropHandle | null;

    // Хранилище сообщений и менеджеры
    store: Store<SecretChatMessageRecord>;
    typingStatus: TypingStatus;
    readReceiptsBatcher: ReadReceiptsBatcher;

    // Подписки на события Store и менеджера
    storeUnsubs: Array<() => void>;
    managerUnsub: (() => void) | null;

    // ***************************************************************************
    // Инициализация
    // ***************************************************************************
    async _init(): Promise<void> {

        // Подписываемся на события Store.
        subscribeStoreEvents(this);

        // Открытие
        await this._open();

    }

    // ***************************************************************************
    // Открытие
    // ***************************************************************************
    async _open(): Promise<void> {

        try {

            // Шаблон формы
            const tpl = this._template();
            if (!tpl) {
                Logger.error("[app][secret-chat]: Не удалось построить шаблон формы");
                return;
            }
            this.tpl = tpl;

            // Форма
            this.modal = new Overlay(tpl, {
                type: "form",
                url: `?secretChatId=${this.chatId}`,
                insertInto: this.options.insertInto,
                closeOnEsc: false,
                closeOnOverlay: false,
                onBeforeOpen: async () => await this._onBeforeOpen(),
                onOpen: async () => await this._onOpen(),
                onBeforeClose: () => this._onBeforeClose(),
                openAnimationClass: null,
                closeAnimationClass: null
            });

            // Открываем форму
            this.modal.open();

        } catch (error) {
            Logger.error(error);
        }

    }

    // ***************************************************************************
    // Обработчики
    // ***************************************************************************
    _handlers(): void {

        try {

            // Каркас и его узлы создаются в _open/_onBeforeOpen — без них
            // обвешивать обработчиками нечего
            if (!this.tpl || !this.modal || !this.list || !this.osListScrollInstance) return;

            // Закрыть
            let close = this.tpl.querySelector(":scope >.header [action-close]");
            close?.addEventListener("click", () => this.modal?.close());

            // Профиль собеседника
            let profile = this.tpl.querySelector(":scope >.header [action-profile]");
            profile?.addEventListener("click", () => this._openPeerProfile());

            // Контекстное меню
            let menu = this.tpl.querySelector(":scope >.header [action-context-menu]");
            menu?.addEventListener("click", (event) => contextMenuHandler(event, this));

            // Сверка ключей (эмодзи + отпечаток)
            let verify = this.tpl.querySelector(":scope >.header [action-verify]");
            verify?.addEventListener("click", () => verifyChatHandler(this));

            // Секретный звонок собеседнику (звонок живёт отдельно от чата)
            let call = this.tpl.querySelector(":scope >.header [action-call]");
            call?.addEventListener("click", () => startSecretCallHandler(this));

            // Скролл вниз
            let scrollDown = this.tpl.querySelector(":scope >[action-scroll-down]");
            scrollDown?.addEventListener("click", () => scrollDownHandler(this));

            // Открыть emoji
            let emoji = this.tpl.querySelector(":scope >.footer [action-emoji]");
            emoji?.addEventListener("click", () => emojiHandler(this));

            // Прикрепить файл
            let attachFile = this.tpl.querySelector(":scope >.footer [action-attach-file]");
            attachFile?.addEventListener("click", () => attachDocumentHandler(this));

            // Прикрепить файл из буфера обмена
            this.textarea?.addEventListener("paste", (event) => textareaPasteBufferHandler(event, this));

            // Перетаскивание файлов в область чата
            this.dragAndDrop = dragAndDropFilesHandler(this);

            // Общая кнопка: тап переключает голос/видео, удержание записывает.
            let recordVoice = this.tpl.querySelector<HTMLElement>(":scope >.footer [data-note-recorder]");
            if (recordVoice) voiceNotePointerHandler(this, recordVoice);

            // Отмена записи голосового сообщения (кнопка X на панели)
            let cancelVoiceNote = this.tpl.querySelector(":scope [action-voice-note-cancel]");
            cancelVoiceNote?.addEventListener("click", () => this.voiceNoteSession?.cancel());

            // Пауза/продолжение записи голосового (кнопка на панели)
            let pauseVoiceNote = this.tpl.querySelector(":scope [action-voice-note-pause]");
            pauseVoiceNote?.addEventListener("click", () => this.voiceNoteSession?.togglePause());

            // Отправить голосовое сообщение (кнопка на панели)
            let sendVoiceNote = this.tpl.querySelector(":scope [action-voice-note-send]");
            sendVoiceNote?.addEventListener("click", () => this.voiceNoteSession?.stop());

            // =========================

            // Смена камеры в видео кружочке
            let switchCameraVideoNote = this.tpl.querySelector(":scope [action-video-note-switch-camera]");
            switchCameraVideoNote?.addEventListener("click", () => switchCameraVideoNoteHandler(this));

            // Поставить на паузу запись кружочка
            let pauseRecordVideoNote = this.tpl.querySelector(":scope [action-video-note-pause]");
            pauseRecordVideoNote?.addEventListener("click", () => pauseResumeVideoNoteHandler(this));

            // Остановить запись кружочка и отправить
            let stopRecordVideoNote = this.tpl.querySelector(":scope [action-video-note-stop]");
            stopRecordVideoNote?.addEventListener("click", () => stopVideoNoteHandler(this));

            // Создать сообщение
            let createMessage = this.tpl.querySelector(":scope >.footer [action-create-message]");
            createMessage?.addEventListener("click", () => createMessageHandler(this));

            // Сохранить сообщение
            let updateMessage = this.tpl.querySelector(":scope >.footer [action-update-message]");
            updateMessage?.addEventListener("click", () => updateMessageHandler(this));

            let cancelEditMessage = this.tpl.querySelector(":scope >.footer [action-cancel-edit]");
            cancelEditMessage?.addEventListener("click", () => cancelEditMessageHandler(this));

            // Нажатие клавиш в textarea: keydown даёт KeyboardEvent, input — InputEvent
            // (оба входят в TextareaInputEvent, который принимает обработчик)
            this.textarea?.addEventListener("keydown", (event) => onInputTextareaHandler(event, this));
            this.textarea?.addEventListener("input", (event) => onInputTextareaHandler(event, this));

            // При скролле (список захватывается сейчас: чтение свойства в
            // замыкании сужение не сохраняет)
            const list = this.list;
            this.osListScrollInstance.on("scroll", (osInstance) => {
                const viewport = osInstance.elements().viewport;
                onContentScrollHandler(this, viewport, list.children);
            });

        } catch (error) {
            Logger.error(error);
        }

    }

    // ***************************************************************************
    // Настройка формы
    // ***************************************************************************
    async _onBeforeOpen(): Promise<boolean | void> {

        try {

            // Шаблон и модалка создаются в _open до вызова хука
            if (!this.tpl || !this.modal) return;

            // Получаем контейнер content
            this.content = this.tpl.querySelector(":scope >.content");

            // Устанавливаем список
            this.list = this.tpl.querySelector(":scope >.content [data-list]");

            // textarea
            this.textarea = this.tpl.querySelector<HTMLTextAreaElement>(`:scope >.footer [name="message"]`);

            // Кнопка прокрутки вниз
            this.scrollDownBtn = this.tpl.querySelector(":scope >[action-scroll-down]");

            // Контейнер для отображения ответов и редактирования
            this.replyContainer = this.tpl.querySelector(":scope >.footer [data-reply-container]");
            this.editContainer = this.tpl.querySelector(":scope >.footer [data-edit-container]");

            // Имя и подзаголовок шапки (заполняет renderHeader)
            this.name = this.tpl.querySelector(":scope >.header [data-name]");
            this.subtitle = this.tpl.querySelector(":scope >.header [data-subtitle]");

            // Получаем чат из локальной БД (история секретных чатов — только локальная)
            const chat = await secretChatsTable().get(this.chatId);
            if (!chat) throw new Error(`Секретный чат не найден: ${this.chatId}`);
            this.chat = chat;

            // Имя и аватар собеседника: профиль может быть недоступен —
            // тогда показываем id (лучше, чем пустое имя)
            this.peerName = chat.peer_user_id;
            try {

                const response = await getUserInfoRequest({ user_id: chat.peer_user_id });
                if (response.status && response.data) {
                    this.peerName = response.data.display_name;
                    this.peerAvatar = response.data.avatar ?? null;
                }

            } catch (error) {
                Logger.debug("[app][secret-chat]: профиль собеседника недоступен.", error);
            }

            // Заполняем шапку: имя, бейдж таймера, подзаголовок состояния
            renderHeader(this);

            // Аватар собеседника
            const avatarElement = this.tpl.querySelector<HTMLElement>(":scope >.header .cdm-avatar");
            this.avatar = Avatars.create({
                element: avatarElement,
                id: chat.peer_user_id,
                name: this.peerName,
                image: this.peerAvatar,
                size: "md",
                wrapClasses: ["rounded-full"]
            });

            // Получаем значение рут переменной
            let root = document.documentElement;

            // Устанавливаем размер текста сообщения
            root.style.setProperty("--message-text-size", `${LocalStorage.session?.settings?.user?.decorations?.message_text_size}rem`);

            // ==================================

            // Если установлен chat_backgrounds
            const session = LocalStorage.session;
            if (session?.settings?.user?.decorations?.chat_background?.enabled) {

                // Устанавливаем менеджер фонов для чата
                this.svgMaskManager = new SvgMaskManager(this.tpl, `${session.settings.user.decorations.chat_background.src}`);

                // Инициализация менеджера фонов для чата
                await this.svgMaskManager.init();

            }

            // ==================================

            // Сообщаем системе, что форма открыта
            window.dispatchEvent(new CustomEvent("[app][form]::opened", {
                detail: {
                    id: this.modal.options.id,
                    data: {
                        instance: this,
                        title: this.peerName,
                        subtitle: t("forms.secret_chat.tab_subtitle")
                    }
                }
            }));

        } catch (error) {
            Logger.error(error);
        }

    }

    // ***************************************************************************
    // Форма открылась
    // ***************************************************************************
    async _onOpen(): Promise<void> {

        // Узлы выставляет _onBeforeOpen: без textarea и контейнера
        // инициализировать автосайз/скролл не из чего
        if (!this.textarea || !this.content) return;

        // Заставляем textarea автоматически подстраиваться под контент
        this.textareaAutosize = new TextareaAutosize(this.textarea);

        // Инициализируем скроллбар
        this.osListScrollInstance = OverlayScrollbars(this.content, {
            scrollbars: { autoHide: "scroll" }, overflow: { x: "hidden", y: "scroll" }
        });

        // Инициируем скролл менеджер
        this.listScrollManager = new ScrollManager(this.osListScrollInstance);

        // Запускаем прослушивание observer
        this.observer = new IntersectionObserver((entries, observer) => {
            intersection(entries, observer, this);
        }, {
            root: this.osListScrollInstance.elements().viewport,
            rootMargin: "0px 0px -5% 0px",
            threshold: [0, 0.01, 0.1]
        });

        // Устанавливаем обработчики
        this._handlers();

        // Подписка на события менеджера (сообщения, соединение, typing)
        this.managerUnsub = subscribeManagerEvents(this);

        // Получаем сообщения
        firstLoadMessages(this);

    }

    // ***************************************************************************
    // Обновляем данные формы
    // @param data - Запись секретного чата (локальная).
    // ***************************************************************************
    update(data: SecretChatRecord): void {

        // Если нет данных
        if (!data) return;

        // Записываем данные
        this.chat = data;

        // Каркас создаётся в _open: без шаблона заполнять нечего
        if (!this.tpl) return;

        // Перерисовываем шапку (имя, бейдж таймера, подзаголовок)
        renderHeader(this);

    }

    // ***************************************************************************
    // Действия при закрытии формы
    // ***************************************************************************
    async _onBeforeClose(): Promise<void> {

        // Отписываемся от событий Store (item::added / item::removed)
        unsubscribeStoreEvents(this);

        // Отписываемся от событий менеджера (сообщения, соединение, typing)
        this.managerUnsub?.();
        this.managerUnsub = null;

        // Удаляем слушатели жестов микрофона перед закрытием формы
        this.voiceNoteGestureController?.destroy();
        this.voiceNoteGestureController = null;

        // Если идёт запись голосового сообщения или ещё ожидает разрешения
        // микрофона — отменяем и освобождаем ресурсы формы
        if (this.voiceRecorder || this.voiceNoteSession?.isStarting || this.voiceNoteSession?.isStopping) {
            this.voiceNoteSession?.cancel();
        }

        // Если идёт запись видео-кружочка — отменяем и освобождаем камеру
        if (this.videoNoteRecorder?.isStarting || this.videoNoteRecorder?.recorder?.isRecording) {
            this.videoNoteRecorder.cancel();
        }

        // Гасим статус активности: после закрытия чата «печатает…»
        // не должен появляться у собеседника
        this.typingStatus?.destroy();

        // Досылаем и гасим батчер квитанций «прочитано»,
        // чтобы отметки не потерялись при закрытии чата
        await this.readReceiptsBatcher?.flush();
        this.readReceiptsBatcher?.destroy();

        // Очищаем хранилище
        this.store?.removeAll();

        // Снимаем обработчики перетаскивания файлов: после закрытия чата
        // они остались бы жить на удалённом элементе списка
        this.dragAndDrop?.destroy();
        this.dragAndDrop = null;

        // Сбрасываем маркер непрочитанных и его observer
        this.unreadMarkerObserver?.disconnect();
        this.unreadMarkerObserver = null;
        this.unreadMarkerBeforeId = null;

        // Сбрасываем состояние планировщика синхронизации окна
        this._listSyncScheduled = false;
        this._listSyncing = false;
        this._stickToBottom = false;

        // Удаляем экземпляр формы из реестра
        SecretChat.instances.delete(this.chatId);

        // Отключаем наблюдение, чтобы избежать утечек памяти
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Обновляем строку чата в общем списке диалогов (прочтение/превью):
        // квитации «прочитано» уходят перед закрытием, бейдж должен погаснуть
        const main = Main.instance;
        if (main) await updateSecretChatRow(main, this.chatId);

        // Сообщаем системе, что форма закрыта
        window.dispatchEvent(new CustomEvent("[app][form]::closed", {
            detail: { id: this.modal?.options.id }
        }));

    }

    // ***************************************************************************
    // Открыть профиль собеседника.
    // ***************************************************************************
    _openPeerProfile(): void {

        // Без чата открывать профиль не по чему
        if (!this.chat) return;

        // Открываем профиль пользователя (форма сама подтянет данные)
        new UserProfile({ userId: this.chat.peer_user_id });

    }

    // ***************************************************************************
    // Шаблон формы
    // ***************************************************************************
    _template(): HTMLElement | null {

        // Получаем параметр Blur из настроек пользователя
        const isBlur = LocalStorage?.session?.settings?.user?.decorations?.blur || false;

        // Иконка подсказки «свайп вверх — отменить» на панели голосового
        const slideToCancelIcon = Icons.icon("arrow-left", { settings: { stroke: 2.5 } })?.outerHTML ?? "";

        // Мы используем DOMParser для создания DOM без innerHTML
        return new DOMParser().parseFromString(`

            <div class="cdm-form secret-chat flex flex-col ${CDM_FORM_CLASSES()} w-full">
                <div class="header flex flex-row gap-2 p-2 items-center justify-between ${CDM_FORM_HEADER_CLASSES()}">
                    <div class="flex flex-row w-full gap-2 items-center overflow-hidden">
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-close"], icon: "ArrowLeft" })}
                        <div class="relative shrink-0">
                            <div class="cdm-avatar relative"></div>
                            <span data-self-destruct class="absolute right-0 bottom-0 hidden items-center justify-center rounded-full p-0.5 bg-[var(--form-bg)] text-[var(--color-brand)]">${Icons.icon("hourglass", { settings: { size: 12 } })?.outerHTML ?? ""}</span>
                        </div>
                        <div action-profile class="flex flex-col gap-0 overflow-hidden cursor-pointer">
                            <span data-name class="flex flex-row gap-2 items-center font-semibold truncate">
                                <span data-encrypted class="flex items-center shrink-0">${Icons.icon("lock", { settings: { size: 16 } })?.outerHTML ?? ""}</span>
                                <span data-peer-name class="truncate"></span>
                            </span>
                            <span data-subtitle class="text-xs text-secondary truncate"></span>
                        </div>
                    </div>
                    ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-call"], icon: "phone" })}
                    ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-verify"], icon: "fingerprint" })}
                    ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-context-menu"], icon: "dots-vertical" })}
                </div>

                <div class="content w-full h-full flex flex-col bg-[var(--color-black)]/5 dark:bg-[var(--color-black)]/20 ${CDM_FORM_CONTENT_CLASSES()}">
                    <div data-list class="flex flex-col gap-0 w-full"></div>
                </div>

                ${Buttons.primary({ shape: "circle", attributes: ["action-scroll-down"], icon: "ArrowBigDown" })}
                <div data-video-note-preview class="relative flex flex-col gap-3 hidden">
                    <div data-video-note-timer class="flex flex-row gap-2 items-center justify-center text-[var(--color-red)] font-semibold text-lg">
                        <span class="w-2.5 h-2.5 rounded-full bg-[var(--color-red)] animate-pulse"></span>
                        <span data-video-note-timer-value>00:00</span>
                    </div>
                    <div class="relative w-full h-full rounded-full overflow-hidden">
                        <div data-video-wrap class="w-full h-full overflow-hidden rounded-full overflow-hidden"></div>
                        <div data-video-note-progress-wrap class="w-full h-full pointer-events-none rounded-full overflow-hidden"></div>
                    </div>
                    <div data-video-note-action-container class="flex flex-row gap-2 shadow-sm rounded-3xl p-2 items-center ${isBlur ? "backdrop-blur-[20px] bg-[var(--form-bg)]/80" : "bg-[var(--form-bg)]"}">
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-video-note-switch-camera"], icon: "camera-rotate" })}
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-video-note-pause"], icon: "player-pause" })}
                        ${Buttons.danger({ shape: "circle", attributes: ["action-video-note-stop"], icon: { name: "player-stop", settings: { filled: true } } })}
                    </div>
                </div>

                <div class="footer absolute flex flex-col shrink-0 gap-2 pb-[2em] max-lg:pb-0 w-full bottom-0 left-0 z-10">
                    <div data-reply-container class="flex empty:hidden w-[var(--secret-chat-block-max-width)] max-w-[var(--secret-chat-block-max-width)] m-auto"></div>
                    <div data-edit-container class="flex empty:hidden w-[var(--secret-chat-block-max-width)] max-w-[var(--secret-chat-block-max-width)] m-auto"></div>

                    <div data-voice-note-panel class="relative flex flex-row gap-2 p-2 w-full md:w-[var(--secret-chat-block-max-width)] md:max-w-[var(--secret-chat-block-max-width)] shadow-sm rounded-4xl max-md:rounded-none items-center m-auto ${isBlur ? "backdrop-blur-[20px] bg-[var(--form-bg)]/80" : "bg-[var(--form-bg)]"} hidden">
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-voice-note-cancel"], icon: "x" })}
                        <div class="flex flex-row gap-2 items-center justify-center shrink-0">
                            <span data-voice-note-status class="w-2.5 h-2.5 rounded-full bg-[var(--color-red)] animate-pulse"></span>
                            <span data-voice-note-timer class="text-[var(--color-red)] font-semibold tabular-nums text-sm">00:00</span>
                        </div>
                        <div data-voice-note-wave class="flex flex-row flex-1 items-center justify-center gap-0.5 h-8"></div>
                        <div class="flex flex-row gap-2 items-center shrink-0">
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-voice-note-pause"], icon: "player-pause" })}
                            ${Buttons.danger({ shape: "circle", attributes: ["action-voice-note-send"], icon: { name: "send-2", settings: { filled: true } } })}
                        </div>
                        <div data-voice-note-cancel-hint class="hidden absolute inset-0 items-center justify-center gap-2 font-semibold text-sm text-[var(--color-red)]">
                            ${slideToCancelIcon} ${t("forms.secret_chat.voice_recorder.slide_to_cancel")}
                        </div>
                    </div>

                    <div class="wrap-footer flex flex-row gap-0 p-2 w-full md:w-[var(--secret-chat-block-max-width)] md:max-w-[var(--secret-chat-block-max-width)] shadow-sm rounded-4xl max-md:rounded-none items-center m-auto ${isBlur ? "backdrop-blur-[20px] bg-[var(--form-bg)]/80" : "bg-[var(--form-bg)]"}">
                        <div class="flex flex-row gap-0 h-full w-full items-end">
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-emoji"], icon: "mood-smile" })}
                            ${Inputs.textarea({ intent: "transparent", placeholder: t("forms.secret_chat.enter_message"), name: "message", rows: 1 })}
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-attach-file"], icon: "Paperclip" })}
                            <div data-note-recorder data-recording-mode="voice" class="flex shrink-0 select-none touch-none">
                                ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-video-recorder"], classes: ["hidden"], icon: "Video" })}
                                ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-voice-recorder"], icon: "microphone" })}
                            </div>
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-create-message"], classes: ["hidden"], icon: "send-2" })}
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-cancel-edit"], classes: ["hidden"], icon: "X" })}
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-update-message"], classes: ["hidden"], icon: "device-floppy" })}
                        </div>

                    </div>
                </div>
            </div>

        `, "text/html").querySelector<HTMLElement>(".cdm-form");

    }

}
