import { evaluateInPage } from '../page-script.js';
import { downloadsList } from './downloads.js';
import { goBack, goForward, navigate, waitLoad } from './navigation.js';
import { pageInfo, relayToPage, screenshot, snapshot } from './page.js';
import { tabClose, tabNew, tabSwitch, tabsList } from './tabs.js';

/**
 * Tabla de despacho: un manejador por cada comando de COMMAND_SPECS. Una
 * prueba unitaria comprueba que las dos listas coinciden.
 */
export function createCommandHandlers(api) {
  const inPage = (action) => relayToPage(api, action);
  return Object.freeze({
    navigate: (params) => navigate(api, params),
    go_back: () => goBack(api),
    go_forward: () => goForward(api),
    wait_load: (params) => waitLoad(api, params),
    click: inPage('click'),
    type: inPage('type'),
    fill: inPage('fill'),
    press: inPage('press'),
    scroll: inPage('scroll'),
    hover: inPage('hover'),
    select: inPage('select'),
    wait_for: inPage('wait_for'),
    remove_overlays: inPage('remove_overlays'),
    extract: inPage('extract'),
    get_dom: inPage('get_dom'),
    eval: (params) => evaluateInPage(api, params),
    snapshot: () => snapshot(api),
    screenshot: () => screenshot(api),
    page_info: () => pageInfo(api),
    tabs_list: () => tabsList(api),
    tab_switch: (params) => tabSwitch(api, params),
    tab_new: (params) => tabNew(api, params),
    tab_close: (params) => tabClose(api, params),
    downloads_list: (params) => downloadsList(api, params),
  });
}
