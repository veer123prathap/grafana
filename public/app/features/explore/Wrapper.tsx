import React, { Component } from 'react';
import { hot } from 'react-hot-loader';
import { connect } from 'react-redux';

import { StoreState } from 'app/types';
import { ExploreId } from 'app/types/explore';

import { CustomScrollbar, ErrorBoundaryAlert } from '@grafana/ui';
import { initMain, lastSavedUrl, resetExploreAction } from './state/main';
import Explore from './Explore';

interface WrapperProps {
  split: boolean;
  resetExploreAction: typeof resetExploreAction;
  initMain: typeof initMain;
}

export class Wrapper extends Component<WrapperProps> {
  componentWillUnmount() {
    this.props.resetExploreAction({});
  }

  componentDidMount() {
    this.props.initMain();
    lastSavedUrl.left = undefined;
    lastSavedUrl.right = undefined;
  }

  render() {
    const { split } = this.props;

    return (
      <div className="page-scrollbar-wrapper">
        <CustomScrollbar autoHeightMin={'100%'} autoHeightMax={''} className="custom-scrollbar--page">
          <div className="explore-wrapper">
            <ErrorBoundaryAlert style="page">
              <Explore exploreId={ExploreId.left} />
            </ErrorBoundaryAlert>
            {split && (
              <ErrorBoundaryAlert style="page">
                <Explore exploreId={ExploreId.right} />
              </ErrorBoundaryAlert>
            )}
          </div>
        </CustomScrollbar>
      </div>
    );
  }
}

const mapStateToProps = (state: StoreState) => {
  const { split } = state.explore;
  return { split };
};

const mapDispatchToProps = {
  resetExploreAction,
  initMain,
};

export default hot(module)(connect(mapStateToProps, mapDispatchToProps)(Wrapper));
