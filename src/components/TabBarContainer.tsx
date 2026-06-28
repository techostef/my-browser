import React from "react";
import { useActiveTabId, useTabActions, useTabList } from "../store/tabStore";
import TabBar from "./TabBar";

interface Props {
  visible: boolean;
  onClose: () => void;
}

function TabBarContainerInner({ visible, onClose }: Props) {
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  const { addTab, removeTab, removeMultipleTabs, setActiveTab } =
    useTabActions();

  return (
    <TabBar
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitchTab={setActiveTab}
      onAddTab={() => addTab("about:home")}
      onAddIncognitoTab={() => addTab("about:home", true)}
      onRemoveTab={removeTab}
      onCloseAllTabs={removeMultipleTabs}
      visible={visible}
      onClose={onClose}
    />
  );
}

export function useActiveIncognito() {
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  const activeTab = tabs.find((t) => !t.hidden && t.id === activeTabId);
  return !!activeTab?.incognito;
}

export default React.memo(TabBarContainerInner);
