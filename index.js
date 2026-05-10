import { getContext } from '../../../extensions.js';

const EMBODY_FOLDER = 'scripts/extensions/third-party/Extension-Embody';

function bindTopbarDrawerClickHandler() {
    try {
        const extensionsToggle = document.querySelector('#extensions-settings-button .drawer-toggle');
        if (!extensionsToggle) return;

        const events = $._data(extensionsToggle, 'events');
        if (!events?.click?.[0]?.handler) return;

        const drawerToggle = $('#embody-settings-button .drawer-toggle');
        drawerToggle.off('click.embodyDrawer');
        drawerToggle.on('click.embodyDrawer', events.click[0].handler);
    } catch (error) {
        console.warn('[Embody] Failed to bind drawer handler', error);
    }
}

function addSharedUi() {
    $('#embody-settings-button').remove();

    const drawer = $(`
        <div id="embody-settings-button" class="drawer">
            <div class="drawer-toggle drawer-header">
                <div class="drawer-icon fa-solid fa-user-astronaut fa-fw closedIcon" title="Embody"></div>
            </div>
            <div class="drawer-content closedDrawer">
                <div id="embody_settings" class="embody-settings-root">
                    <div class="embody-header">
                        <div>
                            <h3 class="margin0">Embody</h3>
                            <small class="text_muted">VoiceForge, Intiface, and VRM in one extension</small>
                        </div>
                    </div>
                    <div class="embody-tabs">
                        <button class="menu_button embody-tab active" data-embody-tab="voiceforge">VoiceForge</button>
                        <button class="menu_button embody-tab" data-embody-tab="intiface">Intiface</button>
                        <button class="menu_button embody-tab" data-embody-tab="vrm">VRM</button>
                    </div>
                    <div class="embody-panel active" id="embody-voiceforge-panel"></div>
                    <div class="embody-panel" id="embody-intiface-panel"></div>
                    <div class="embody-panel" id="embody-vrm-panel"></div>
                </div>
            </div>
        </div>
    `);

    $('#extensions-settings-button').after(drawer);
    bindTopbarDrawerClickHandler();

    drawer.on('click', '.embody-tab', function () {
        const tab = String($(this).data('embody-tab') || 'voiceforge');
        drawer.find('.embody-tab').removeClass('active');
        $(this).addClass('active');
        drawer.find('.embody-panel').removeClass('active');
        drawer.find(`#embody-${tab}-panel`).addClass('active');
    });
}

jQuery(async () => {
    addSharedUi();

    // Expose the combined extension path for copied modules that need asset URLs.
    globalThis.EMBODY_EXTENSION_FOLDER = EMBODY_FOLDER;

    await import('./voiceforge/index.js');
    await import('./intiface/index.js');
    await import('./vrm/index.js');

    console.info('[Embody] Combined extension loaded', getContext()?.extensionSettings);
});
