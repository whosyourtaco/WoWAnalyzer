import SPELLS from 'common/SPELLS';
import COVENANTS from 'game/shadowlands/COVENANTS';
import { SpellIcon, SpellLink } from 'interface';
import Analyzer, { Options, SELECTED_PLAYER, SELECTED_PLAYER_PET } from 'parser/core/Analyzer';
import Events, { ApplyBuffEvent, RefreshBuffEvent, SummonEvent } from 'parser/core/Events';
import BoringValueText from 'parser/ui/BoringValueText';
import Statistic from 'parser/ui/Statistic';
import STATISTIC_CATEGORY from 'parser/ui/STATISTIC_CATEGORY';
import STATISTIC_ORDER from 'parser/ui/STATISTIC_ORDER';
import React from 'react';

class FallenOrderCraneAverage extends Analyzer {
  soomCasts: number = 0;
  envCasts: number = 0;
  mwClones: number = 0;

  constructor(options: Options) {
    super(options);

    this.active = this.selectedCombatant.hasCovenant(COVENANTS.VENTHYR.id);

    if (!this.active) {
      return;
    }

    //summon events (need to track this to get melees)
    this.addEventListener(
      Events.summon.by(SELECTED_PLAYER).spell(SPELLS.FALLEN_ORDER_CRANE_CLONE),
      this.trackSummons,
    );

    //mistweaver spells
    this.addEventListener(
      Events.applybuff.by(SELECTED_PLAYER_PET).spell(SPELLS.FALLEN_ORDER_ENVELOPING_MIST),
      this.envBuffApplied,
    );

    this.addEventListener(
      Events.refreshbuff.by(SELECTED_PLAYER_PET).spell(SPELLS.FALLEN_ORDER_ENVELOPING_MIST),
      this.envBuffApplied,
    );

    this.addEventListener(
      Events.applybuff.by(SELECTED_PLAYER_PET).spell(SPELLS.FALLEN_ORDER_SOOTHING_MIST),
      this.soomBuffApplied,
    );

    this.addEventListener(
      Events.refreshbuff.by(SELECTED_PLAYER_PET).spell(SPELLS.FALLEN_ORDER_SOOTHING_MIST),
      this.soomBuffApplied,
    );
  }

  trackSummons(event: SummonEvent) {
    this.mwClones += 1;
  }

  envBuffApplied(event: ApplyBuffEvent | RefreshBuffEvent) {
    this.envCasts += 1;
  }

  soomBuffApplied(event: ApplyBuffEvent | RefreshBuffEvent) {
    this.soomCasts += 1;
  }

  statistic() {
    return (
      <Statistic
        position={STATISTIC_ORDER.CORE()}
        size="flexible"
        category={STATISTIC_CATEGORY.COVENANTS}
        tooltip={
          <>
            This is the average number of casts a Crane Clone does.
            <br />
            Number of MW clones: {this.mwClones} <br />
            Total Enveloping Mist Casts from Clones: {this.envCasts} <br />
            Total Soothing Mist Casts from Clones: {this.soomCasts}
          </>
        }
      >
        <BoringValueText
          label={
            <>
              <SpellIcon id={SPELLS.FALLEN_ORDER_CRANE_CLONE.id} /> Average Crane Clone Casts
            </>
          }
        >
          <SpellLink id={SPELLS.FALLEN_ORDER_ENVELOPING_MIST.id} />{' '}
          {(this.envCasts / this.mwClones).toFixed(2)}
          <br />
          <SpellLink id={SPELLS.FALLEN_ORDER_SOOTHING_MIST.id} />{' '}
          {(this.soomCasts / this.mwClones).toFixed(2)}
        </BoringValueText>
      </Statistic>
    );
  }
}

export default FallenOrderCraneAverage;
