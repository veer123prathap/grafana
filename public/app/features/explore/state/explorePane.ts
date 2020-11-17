import { AnyAction } from 'redux';
import _ from 'lodash';

import { DEFAULT_RANGE, getQueryKeys, parseUrlState } from 'app/core/utils/explore';
import { ExploreId, ExploreItemState } from 'app/types/explore';
import { queryReducer } from './query';
import { datasourceReducer } from './datasource';
import { timeReducer } from './time';
import { historyReducer } from './history';
import { makeExplorePaneState, loadAndInitDatasource, createEmptyQueryResponse } from './utils';
import { createAction, PayloadAction } from '@reduxjs/toolkit';
import {
  EventBusExtended,
  DataQuery,
  LogLevel,
  LogsDedupStrategy,
  TimeRange,
  HistoryItem,
  DataSourceApi,
  ExploreUrlState,
} from '@grafana/data';
import { ensureQueries, generateNewKeyAndAddRefIdIfMissing, getTimeRangeFromUrl } from 'app/core/utils/explore';
import { getRichHistory } from 'app/core/utils/richHistory';
// Types
import { ThunkResult } from 'app/types';
import { getTimeZone } from 'app/features/profile/state/selectors';
import { getUrlStateFromPaneState, richHistoryUpdatedAction } from './main';
import { runQueries, setQueriesAction } from './query';
import { updateTime } from './time';
import { getExploreDatasources } from './selectors';

//
// Actions and Payloads
//

/**
 * Keep track of the Explore container size, in particular the width.
 * The width will be used to calculate graph intervals (number of datapoints).
 */
export interface ChangeSizePayload {
  exploreId: ExploreId;
  width: number;
  height: number;
}
export const changeSizeAction = createAction<ChangeSizePayload>('explore/changeSize');

/**
 * Change deduplication strategy for logs.
 */
export interface ChangeDedupStrategyPayload {
  exploreId: ExploreId;
  dedupStrategy: LogsDedupStrategy;
}
export const changeDedupStrategyAction = createAction<ChangeDedupStrategyPayload>('explore/changeDedupStrategyAction');

/**
 * Highlight expressions in the log results
 */
export interface HighlightLogsExpressionPayload {
  exploreId: ExploreId;
  expressions: string[];
}
export const highlightLogsExpressionAction = createAction<HighlightLogsExpressionPayload>(
  'explore/highlightLogsExpression'
);

/**
 * Initialize Explore state with state from the URL and the React component.
 * Call this only on components for with the Explore state has not been initialized.
 */
export interface InitializeExplorePayload {
  exploreId: ExploreId;
  containerWidth: number;
  eventBridge: EventBusExtended;
  queries: DataQuery[];
  range: TimeRange;
  history: HistoryItem[];
  datasourceInstance?: DataSourceApi;
  originPanelId?: number | null;
}
export const initializeExploreAction = createAction<InitializeExplorePayload>('explore/initializeExplore');

export interface ToggleLogLevelPayload {
  exploreId: ExploreId;
  hiddenLogLevels: LogLevel[];
}
export const toggleLogLevelAction = createAction<ToggleLogLevelPayload>('explore/toggleLogLevel');

export interface SetUrlReplacedPayload {
  exploreId: ExploreId;
}
export const setUrlReplacedAction = createAction<SetUrlReplacedPayload>('explore/setUrlReplaced');

/**
 * Keep track of the Explore container size, in particular the width.
 * The width will be used to calculate graph intervals (number of datapoints).
 */
export function changeSize(
  exploreId: ExploreId,
  { height, width }: { height: number; width: number }
): PayloadAction<ChangeSizePayload> {
  return changeSizeAction({ exploreId, height, width });
}

/**
 * Change logs deduplication strategy.
 */
export const changeDedupStrategy = (
  exploreId: ExploreId,
  dedupStrategy: LogsDedupStrategy
): PayloadAction<ChangeDedupStrategyPayload> => {
  return changeDedupStrategyAction({ exploreId, dedupStrategy });
};

/**
 * Initialize Explore state with state from the URL and the React component.
 * Call this only on components for with the Explore state has not been initialized.
 */
export function initializeExplore(
  exploreId: ExploreId,
  datasourceName: string,
  queries: DataQuery[],
  range: TimeRange,
  containerWidth: number,
  eventBridge: EventBusExtended,
  originPanelId?: number | null
): ThunkResult<void> {
  return async (dispatch, getState) => {
    const exploreDatasources = getExploreDatasources();
    let instance = undefined;
    let history: HistoryItem[] = [];

    if (exploreDatasources.length >= 1) {
      const orgId = getState().user.orgId;
      const loadResult = await loadAndInitDatasource(orgId, datasourceName);
      instance = loadResult.instance;
      history = loadResult.history;
    }

    dispatch(
      initializeExploreAction({
        exploreId,
        containerWidth,
        eventBridge,
        queries,
        range,
        originPanelId,
        datasourceInstance: instance,
        history,
      })
    );
    dispatch(updateTime({ exploreId }));

    if (instance) {
      dispatch(runQueries(exploreId));
    }

    const richHistory = getRichHistory();
    dispatch(richHistoryUpdatedAction({ richHistory }));
  };
}

/**
 * Reacts to changes in URL state that we need to sync back to our redux state. Checks the internal update variable
 * to see which parts change and need to be synced.
 */
export function refreshExplore(exploreId: ExploreId, urlQuery: string): ThunkResult<void> {
  return (dispatch, getState) => {
    const itemState = getState().explore[exploreId];
    if (!itemState.initialized) {
      return;
    }

    const urlState = parseUrlState(urlQuery);
    const update = urlDiff(urlState, getUrlStateFromPaneState(itemState));

    const { containerWidth, eventBridge } = itemState;

    const { datasource, queries, range: urlRange, originPanelId } = urlState;
    const refreshQueries: DataQuery[] = [];

    for (let index = 0; index < queries.length; index++) {
      const query = queries[index];
      refreshQueries.push(generateNewKeyAndAddRefIdIfMissing(query, refreshQueries, index));
    }

    const timeZone = getTimeZone(getState().user);
    const range = getTimeRangeFromUrl(urlRange, timeZone);

    // need to refresh datasource
    if (update.datasource) {
      const initialQueries = ensureQueries(queries);
      dispatch(
        initializeExplore(exploreId, datasource, initialQueries, range, containerWidth, eventBridge, originPanelId)
      );
      return;
    }

    if (update.range) {
      dispatch(updateTime({ exploreId, rawRange: range.raw }));
    }

    // need to refresh queries
    if (update.queries) {
      dispatch(setQueriesAction({ exploreId, queries: refreshQueries }));
    }

    // always run queries when refresh is needed
    if (update.queries || update.range) {
      dispatch(runQueries(exploreId));
    }
  };
}

/**
 * Reducer for an Explore area, to be used by the global Explore reducer.
 */
// Redux Toolkit uses ImmerJs as part of their solution to ensure that state objects are not mutated.
// ImmerJs has an autoFreeze option that freezes objects from change which means this reducer can't be migrated to createSlice
// because the state would become frozen and during run time we would get errors because flot (Graph lib) would try to mutate
// the frozen state.
// https://github.com/reduxjs/redux-toolkit/issues/242
export const paneReducer = (state: ExploreItemState = makeExplorePaneState(), action: AnyAction): ExploreItemState => {
  state = queryReducer(state, action);
  state = datasourceReducer(state, action);
  state = timeReducer(state, action);
  state = historyReducer(state, action);

  if (changeSizeAction.match(action)) {
    const containerWidth = action.payload.width;
    return { ...state, containerWidth };
  }

  if (highlightLogsExpressionAction.match(action)) {
    const { expressions } = action.payload;
    return { ...state, logsHighlighterExpressions: expressions };
  }

  if (changeDedupStrategyAction.match(action)) {
    const { dedupStrategy } = action.payload;
    return {
      ...state,
      dedupStrategy,
    };
  }

  if (initializeExploreAction.match(action)) {
    const { containerWidth, eventBridge, queries, range, originPanelId, datasourceInstance, history } = action.payload;
    return {
      ...state,
      containerWidth,
      eventBridge,
      range,
      queries,
      initialized: true,
      queryKeys: getQueryKeys(queries, state.datasourceInstance),
      originPanelId,
      datasourceInstance,
      history,
      datasourceMissing: !datasourceInstance,
      queryResponse: createEmptyQueryResponse(),
      logsHighlighterExpressions: undefined,
    };
  }

  if (toggleLogLevelAction.match(action)) {
    const { hiddenLogLevels } = action.payload;
    return {
      ...state,
      hiddenLogLevels: Array.from(hiddenLogLevels),
    };
  }

  return state;
};

/**
 * Compare 2 explore urls and return a map of what changed. Used to update the local state with all the
 * side effects needed.
 */
export const urlDiff = (
  oldUrlState: ExploreUrlState | undefined,
  currentUrlState: ExploreUrlState | undefined
): {
  datasource: boolean;
  queries: boolean;
  range: boolean;
} => {
  const datasource = !_.isEqual(currentUrlState?.datasource, oldUrlState?.datasource);
  const queries = !_.isEqual(currentUrlState?.queries, oldUrlState?.queries);
  const range = !_.isEqual(currentUrlState?.range || DEFAULT_RANGE, oldUrlState?.range || DEFAULT_RANGE);

  return {
    datasource,
    queries,
    range,
  };
};
