"use client";

import { IntelligenceAtlasWorkspaceView } from "./intelligence-atlas-workspace-shell";
import {
  useAtlasData,
  useAtlasGlobalKeyboard,
  useAtlasNavigationState,
  useAtlasSearch,
} from "./intelligence-atlas-workspace-hooks";
import { useAtlasWorkspaceController } from "./intelligence-atlas-workspace-actions";

export const IntelligenceAtlasWorkspace = () => {
  const navigation = useAtlasNavigationState();
  const search = useAtlasSearch(navigation.state, navigation.writeState);
  useAtlasGlobalKeyboard(
    navigation.state,
    search.searchOpen,
    search.setSearchOpen,
    search.searchInputRef,
    navigation.writeState,
  );
  const atlas = useAtlasData(navigation.state);
  const controller = useAtlasWorkspaceController(
    navigation.state,
    navigation.push,
    navigation.writeState,
    search,
    atlas,
  );
  return (
    <IntelligenceAtlasWorkspaceView
      state={navigation.state}
      writeState={navigation.writeState}
      search={search}
      atlas={atlas.view}
      controller={controller}
    />
  );
};
