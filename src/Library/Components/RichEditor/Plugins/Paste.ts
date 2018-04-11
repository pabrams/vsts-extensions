import { onImageAdd } from "Library/Components/RichEditor/Toolbar/Buttons";
import { buildSnapshot, Editor, EditorPlugin, restoreSnapshot } from "roosterjs-editor-core";
import {
    applyFormat, fromHtml, getFirstLeafNode, getNextLeafSibling, sanitizeHtml,
    SanitizeHtmlPropertyCallback
} from "roosterjs-editor-dom";
import buildClipboardData from "roosterjs-editor-plugins/lib/Paste/buildClipboardData";
import textToHtml from "roosterjs-editor-plugins/lib/Paste/textToHtml";
import convertPastedContentFromWord from "roosterjs-editor-plugins/lib/Paste/wordConverter/convertPastedContentFromWord";
import {
    BeforePasteEvent, ChangeSource, ClipboardData, DefaultFormat, NodeType, PasteOption,
    PluginEvent, PluginEventType
} from "roosterjs-editor-types";

/**
 * Paste plugin, handles onPaste event and paste content into editor
 */
export class Paste implements EditorPlugin {
    private _editor: Editor;
    private _pasteDisposer: () => void;

    /**
     * Create an instance of Paste
     * @param _useDirectPaste: This is a test parameter and may be removed in the future.
     * When set to true, we retrieve HTML from clipboard directly rather than using a hidden pasting DIV,
     * then filter out unsafe HTML tags and attributes. Although we removed some unsafe tags such as SCRIPT,
     * OBJECT, ... But there is still risk to have other kinds of XSS scripts embeded. So please do NOT use
     * this parameter if you don't have other XSS detecting logic outside the edtior.
     */
    constructor(
        private _getPastedImageUrl: (data: string) => Promise<string>,
        private _useDirectPaste?: boolean,
        private _htmlPropertyCallbacks?: SanitizeHtmlPropertyCallback
    ) {}

    public initialize(editor: Editor) {
        this._editor = editor;
        this._pasteDisposer = editor.addDomEventHandler("paste", this._onPaste);
    }

    public dispose() {
        this._pasteDisposer();
        this._pasteDisposer = null;
        this._editor = null;
    }

    public onPluginEvent(event: PluginEvent) {
        if (event.eventType === PluginEventType.BeforePaste) {
            const beforePasteEvent = <BeforePasteEvent>event;

            if (beforePasteEvent.pasteOption === PasteOption.PasteHtml) {
                convertPastedContentFromWord(beforePasteEvent.fragment);
            }
        }
    }

    /**
     * Paste into editor using passed in clipboardData with original format
     * @param clipboardData The clipboardData to paste
     */
    public pasteOriginal(clipboardData: ClipboardData) {
        this._paste(clipboardData, this._detectPasteOption(clipboardData));
    }

    /**
     * Paste plain text into editor using passed in clipboardData
     * @param clipboardData The clipboardData to paste
     */
    public pasteText(clipboardData: ClipboardData) {
        this._paste(clipboardData, PasteOption.PasteText);
    }

    /**
     * Paste into editor using passed in clipboardData with curent format
     * @param clipboardData The clipboardData to paste
     */
    public pasteAndMergeFormat(clipboardData: ClipboardData) {
        this._paste(clipboardData, this._detectPasteOption(clipboardData), true);
    }

    private _onPaste = (event: Event) => {
        this._editor.addUndoSnapshot();
        buildClipboardData(
            <ClipboardEvent>event,
            this._editor,
            clipboardData => {
                if (!clipboardData.html && clipboardData.text) {
                    clipboardData.html = textToHtml(clipboardData.text);
                }
                if (!clipboardData.isHtmlFromTempDiv) {
                    clipboardData.html = sanitizeHtml(
                        clipboardData.html,
                        null,
                        false,
                        this._htmlPropertyCallbacks,
                        true
                    );
                }
                this.pasteOriginal(clipboardData);
            },
            this._useDirectPaste
        );
    }

    private _detectPasteOption(clipboardData: ClipboardData): PasteOption {
        return clipboardData.text || !clipboardData.image
            ? PasteOption.PasteHtml
            : PasteOption.PasteImage;
    }

    private _paste(
        clipboardData: ClipboardData,
        pasteOption: PasteOption,
        mergeCurrentFormat?: boolean
    ) {
        const document = this._editor.getDocument();
        const fragment = document.createDocumentFragment();

        if (pasteOption === PasteOption.PasteHtml) {
            const html = clipboardData.html;
            const nodes = fromHtml(html, document);

            for (const node of nodes) {
                if (mergeCurrentFormat) {
                    this._applyTextFormat(node, clipboardData.originalFormat);
                }
                fragment.appendChild(node);
            }
        }

        const event: BeforePasteEvent = {
            eventType: PluginEventType.BeforePaste,
            clipboardData: clipboardData,
            fragment: fragment,
            pasteOption: pasteOption,
        };

        this._editor.triggerEvent(event, true);
        this._internalPaste(event);
    }

    private _internalPaste(event: BeforePasteEvent) {
        const { clipboardData, fragment, pasteOption } = event;
        this._editor.focus();
        if (clipboardData.snapshotBeforePaste == null) {
            clipboardData.snapshotBeforePaste = buildSnapshot(this._editor);
        } else {
            restoreSnapshot(this._editor, clipboardData.snapshotBeforePaste);
        }

        switch (pasteOption) {
            case PasteOption.PasteHtml:
                this._editor.insertNode(fragment);
                break;

            case PasteOption.PasteText:
                const html = textToHtml(clipboardData.text);
                this._editor.insertContent(html);
                break;

            default:
                onImageAdd(this._editor, clipboardData.image, this._getPastedImageUrl);
                break;
        }

        this._editor.triggerContentChangedEvent(ChangeSource.Paste, clipboardData);
        this._editor.addUndoSnapshot();
    }

    private _applyTextFormat(node: Node, format: DefaultFormat) {
        let leaf = getFirstLeafNode(node);
        const parents: HTMLElement[] = [];
        while (leaf) {
            if (
                leaf.nodeType === NodeType.Text &&
                leaf.parentNode &&
                parents.indexOf(<HTMLElement>leaf.parentNode) < 0
            ) {
                parents.push(<HTMLElement>leaf.parentNode);
            }
            leaf = getNextLeafSibling(node, leaf);
        }
        for (const parent of parents) {
            applyFormat(parent, format);
        }
    }
}