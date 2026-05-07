import React, { useState, useCallback } from "react";
import TabBar, { TabCountTrigger } from "./TabBar";
import { useTabList, useActiveTabId, useTabActions } from "../store/tabStore";
import { useSettings } from "../store/settingsStore";

function TabBarContainerInner() {
  const [visible, setVisible] = useState(false);
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  const { addTab, removeTab, setActiveTab } = useTabActions();
  const { homeUrl } = useSettings();

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const visibleCount = tabs.filter((t) => !t.hidden).length;

  return (
    <>
      <TabCountTrigger count={visibleCount} onPress={open} />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={setActiveTab}
        onAddTab={() => addTab(homeUrl())}
        onRemoveTab={removeTab}
        visible={visible}
        onClose={close}
      />
    </>
  );
}

export default React.memo(TabBarContainerInner);
