import React, { useState, useCallback } from "react";
import TabBar, { TabCountTrigger } from "./TabBar";
import { useTabList, useActiveTabId, useTabActions } from "../store/tabStore";

function TabBarContainerInner() {
  const [visible, setVisible] = useState(false);
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  const { addTab, removeTab, setActiveTab } = useTabActions();

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  const visibleTabs = tabs.filter((t) => !t.hidden);
  const activeTab = visibleTabs.find((t) => t.id === activeTabId);
  const isActiveIncognito = !!activeTab?.incognito;

  // Count shown on trigger reflects the current segment's tabs
  const displayCount = isActiveIncognito
    ? visibleTabs.filter((t) => t.incognito).length
    : visibleTabs.filter((t) => !t.incognito).length;

  return (
    <>
      <TabCountTrigger
        count={displayCount}
        isIncognito={isActiveIncognito}
        onPress={open}
      />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={setActiveTab}
        onAddTab={() => addTab('about:home')}
        onAddIncognitoTab={() => addTab('about:home', true)}
        onRemoveTab={removeTab}
        visible={visible}
        onClose={close}
      />
    </>
  );
}

export default React.memo(TabBarContainerInner);
