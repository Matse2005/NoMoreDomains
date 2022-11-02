// Keep service worker alive
let lifeline;
const KEEP_ALIVE = "keepAlive";
var DOMAIN_RULES_URL = "https://raw.githubusercontent.com/immattdavison/NoMoreDomains/master/domains.json";

keepAlive();

async function keepAlive() {
  if (lifeline) return;
  for (const tab of await chrome.tabs.query({ url: "*://*/*" })) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          chrome.runtime.connect({ name: KEEP_ALIVE });
        },
      });
      chrome.tabs.onUpdated.removeListener(retryOnTabUpdate);
      return;
    } catch (error) {
      console.log("NO_MORE_DOMAINS:ERROR ", error);
    }
  }
  chrome.tabs.onUpdated.addListener(retryOnTabUpdate);
}

function keepAliveForced() {
  lifeline?.disconnect();
  lifeline = null;
  keepAlive();
}

async function retryOnTabUpdate(tabId, info, tab) {
  if (info.url && /^(file|https?):/.test(info.url)) {
    keepAlive();
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === KEEP_ALIVE) {
    lifeline = port;
    setTimeout(keepAliveForced, 295e3);
    port.onDisconnect.addListener(keepAliveForced);
  }
});

// Fetch and add rules to declarativeNetRequest
function fetchProtectionRules(url,status){
  fetch(url)
  .then((res) => res.json())
  .then((domains) => {
    if(status==="redirect"){
      chrome.storage.local.set({ "rules_count": domains.length }); // Save the count(number) of rules
      console.log("Disabling domains!");
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: domains.map((_, index) => index + 1),
        addRules: domains.map((domain, index) => ({
          id: index + 1,
          priority: 1,
          action: { type: "redirect", redirect: { extensionPath: "/block.html" } },
          condition: {
            urlFilter: "||"+domain+"^",
            resourceTypes: ["main_frame", "sub_frame"],
          },
        })),
      });
    }
    else if(status==="off"){
      console.log("Allowing domains!");
      // TODO: remove user whitelisting also
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: domains.map((_, index) => index + 1),
        addRules: domains.map((domain, index) => ({
          id: index + 1,
          priority: 2,
          action: { type: "allow"},
          condition: {
            urlFilter: "||"+domain+"^",
            resourceTypes: ["main_frame","sub_frame"],
          },
        })),
      });
    }
  });
}

// saveUpdateTime function sets the current date in chrome's local storage
function saveUpdateTime() {
  const tDate = new Date().toLocaleDateString();
  chrome.storage.local.set({ run_day: tDate });
}

function performUpdate(status) {
  try {
    fetchProtectionRules(DOMAIN_RULES_URL,status);
    console.log("Success: Rules Added");
  } catch (err) {
    console.log("Error fetching rules");
  }
}

// Below code checks if a date is added to the chrome storage.
// 1. If date is added, it compares it with current date and if they mismatch it runs the update
// 2. If date is not added(or is undefined) then it performs an update[This will be the "first time" update] and sets the date
try {
  chrome.storage.local.get(['run_day'], function (result) {
    let checkerDate = new Date().toLocaleDateString();
    if (result.run_day === undefined) {
      try {
        saveUpdateTime();
        performUpdate("redirect");
        console.log("First Update Performed!");
      } catch (err) { console.log("Error while fetching first-run data:E01!"); }
    }
    else if (result.run_day !== checkerDate) {
      try {
        saveUpdateTime();
        performUpdate("redirect");
        console.log("Updated Successfully!");
      } catch (err) { console.log("Error while fetching subsequent data: E02!"); }
    }
  });
} catch (err) {
  console.log(err);
}

// Message passing between popup.js and this script to enable toggle(on/off) functionality
chrome.runtime.onMessage.addListener(
  function (request) {
    if (request.NMD_status==="on"){
      performUpdate("redirect");
    }
    else if (request.NMD_status === "off"){
      performUpdate("off");
    }
    else{
      performUpdate("redirect");
    }
  }
);

// quick delete all rules added by the extensions and regenerate default rules.
async function revertRulesDefault() {
  // remove all rules
  let ruleIds = (await chrome.declarativeNetRequest.getDynamicRules())
    .map((rule)=>rule.id);
  await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds: ruleIds});

  // regenerated default rules
  performUpdate("redirect");
}