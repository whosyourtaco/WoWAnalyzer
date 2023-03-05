import { Trans } from '@lingui/macro';
import { formatPercentage } from 'common/format';
import SPELLS from 'common/SPELLS';
import TALENTS from 'common/TALENTS/shaman';
import { SpellLink } from 'interface';
import Analyzer, { Options, SELECTED_PLAYER } from 'parser/core/Analyzer';
import { calculateEffectiveHealing } from 'parser/core/EventCalculateLib';
import Events, {
  AbsorbedEvent,
  ApplyBuffEvent,
  CastEvent,
  HealEvent,
  RemoveBuffEvent,
} from 'parser/core/Events';
import DonutChart from 'parser/ui/DonutChart';
import Statistic from 'parser/ui/Statistic';
import STATISTIC_CATEGORY from 'parser/ui/STATISTIC_CATEGORY';
import StatisticListBoxItem from 'parser/ui/StatisticListBoxItem';
import { STATISTIC_ORDER } from 'parser/ui/StatisticsListBox';

import {
  DOWNPOUR_CD_PER_HIT,
  DOWNPOUR_TARGETS,
  HEALING_RAIN_TARGETS,
  RESTORATION_COLORS,
  UNLEASH_LIFE_CHAIN_HEAL_INCREASE,
  UNLEASH_LIFE_EXTRA_TARGETS,
  UNLEASH_LIFE_HEALING_INCREASE,
} from '../../constants';
import CooldownThroughputTracker from '../features/CooldownThroughputTracker';
import {
  getHealingRainEvents,
  getHealingRainHealEventsForTick,
  getOverflowingShoresEvents,
  isHealingWaveFromPrimordialWave,
  getChainHeals,
  getDownPourEvents,
} from '../../normalizers/CastLinkNormalizer';
import {
  getUnleashLifeHealingWaves,
  isBuffedByUnleashLife,
  wasUnleashLifeConsumed,
} from '../../normalizers/UnleashLifeNormalizer';
import RiptideTracker from '../core/RiptideTracker';
import ChainHealNormalizer from '../../normalizers/ChainHealNormalizer';

const debug = false;

interface HealingMap {
  [spellId: number]: {
    amount: number;
    casts: number;
  };
}
/**
 * Unleash Life:
 * Unleashes elemental forces of Life, healing a friendly target and increasing the effect of the Shaman's next direct heal.
 */

class UnleashLife extends Analyzer {
  static dependencies = {
    cooldownThroughputTracker: CooldownThroughputTracker,
    riptideTracker: RiptideTracker,
    chainHealNormalizer: ChainHealNormalizer,
  };
  chainHealNormalizer!: ChainHealNormalizer;
  protected riptideTracker!: RiptideTracker;
  protected cooldownThroughputTracker!: CooldownThroughputTracker;

  wastedBuffs: number = 0;
  spellConsumptionMap = new Map<number, number>();
  healingMap: HealingMap = {
    [TALENTS.RIPTIDE_TALENT.id]: {
      amount: 0,
      casts: 0,
    },
    [TALENTS.CHAIN_HEAL_TALENT.id]: {
      amount: 0,
      casts: 0,
    },
    [TALENTS.HEALING_WAVE_TALENT.id]: {
      amount: 0,
      casts: 0,
    },
    [SPELLS.HEALING_SURGE.id]: {
      amount: 0,
      casts: 0,
    },
    [TALENTS.WELLSPRING_TALENT.id]: {
      amount: 0,
      casts: 0,
    },
    [TALENTS.HEALING_RAIN_TALENT.id]: {
      amount: 0,
      casts: 0,
    },
    [TALENTS.DOWNPOUR_TALENT.id]: {
      amount: 0,
      casts: 0,
    },
  };
  //ul direct
  directHealing: number = 0;

  //healing wave
  healingWaveHealing: number = 0;
  pwaveActive: boolean;
  pwaveHealingWaveHealing: number = 0;

  //chain heal
  ancestralReachActive: boolean;
  chainHealHealing: number = 0;
  buffedChainHealTimestamp: number = Number.MIN_SAFE_INTEGER;

  //healing rain
  healingRainHealing: number = 0;
  overflowingShoresActive: boolean;
  overflowingShoresHealing: number = 0;
  countedHealingRainEvents: Set<number> = new Set<number>();
  extraTicks: number = 0;
  missedTicks: number = 0;
  extraOSTicks: number = 0;
  missedOSTicks: number = 0;
 
  //downpour
  missedDownpourHits: number = 0;
  extraDownpourHits: number = 0;

  unleashLifeCount = 0;

  constructor(options: Options) {
    super(options);
    this.active = this.selectedCombatant.hasTalent(TALENTS.UNLEASH_LIFE_TALENT);
    this.pwaveActive = this.selectedCombatant.hasTalent(TALENTS.PRIMORDIAL_WAVE_TALENT);
    this.overflowingShoresActive = this.selectedCombatant.hasTalent(
      TALENTS.OVERFLOWING_SHORES_TALENT,
    );
    this.ancestralReachActive = this.selectedCombatant.hasTalent(TALENTS.ANCESTRAL_REACH_TALENT);
    const spellFilter = [
      TALENTS.RIPTIDE_TALENT,
      TALENTS.CHAIN_HEAL_TALENT,
      TALENTS.HEALING_WAVE_TALENT,
      SPELLS.HEALING_SURGE,
      TALENTS.WELLSPRING_TALENT,
      TALENTS.HEALING_RAIN_TALENT,
      TALENTS.DOWNPOUR_TALENT,
    ];
    this.addEventListener(Events.cast.by(SELECTED_PLAYER).spell(spellFilter), this._onCast);
    this.addEventListener(
      Events.heal.by(SELECTED_PLAYER).spell(TALENTS.UNLEASH_LIFE_TALENT),
      this._onHealUL,
    );
    this.addEventListener(
      Events.absorbed.by(SELECTED_PLAYER).spell(SPELLS.WELLSPRING_UNLEASH_LIFE),
      this._onWellspring,
    );
    this.addEventListener(
      Events.heal.by(SELECTED_PLAYER).spell(SPELLS.HEALING_SURGE),
      this._onHealingSurge,
    );
    this.addEventListener(
      Events.heal.by(SELECTED_PLAYER).spell(TALENTS.RIPTIDE_TALENT),
      this._onRiptide,
    );
    this.addEventListener(
      Events.applybuff.by(SELECTED_PLAYER).spell(TALENTS.UNLEASH_LIFE_TALENT),
      this._onApplyUL,
    );
    this.addEventListener(
      Events.removebuff.by(SELECTED_PLAYER).spell(TALENTS.UNLEASH_LIFE_TALENT),
      this._onRemoveUL,
    );
  }

  _onApplyUL(event: ApplyBuffEvent) {
    this.unleashLifeCount += 1;
  }

  _onHealUL(event: HealEvent) {
    this.directHealing += event.amount + (event.absorbed || 0);
  }

  _onCast(event: CastEvent) {
    const spellId = event.ability.guid;
    if (isBuffedByUnleashLife(event)) {
      this.healingMap[spellId].casts += 1;
      debug && console.log('Unleash Life ' + event.ability.name + ': ', event);
      switch(spellId){
        case(TALENTS.HEALING_WAVE_TALENT.id):
          this._onHealingWave(event);
          break;
        case(TALENTS.HEALING_RAIN_TALENT.id):
          this._onHealingRain(event);
          break;
        case(TALENTS.CHAIN_HEAL_TALENT.id):
          this._onChainHeal(event);
          break;
        case(TALENTS.DOWNPOUR_TALENT.id):
          this._onDownpour(event);
          break;
        default:
          return;
      }
    }
  }

  _onRemoveUL(event: RemoveBuffEvent) {
    if (wasUnleashLifeConsumed(event)) {
      return;
    }
    this.wastedBuffs += 1;
  }

  private _onWellspring(event: AbsorbedEvent) {
    this.healingMap[TALENTS.WELLSPRING_TALENT.id].amount += event.amount;
  }

  private _onHealingSurge(event: HealEvent) {
    if (isBuffedByUnleashLife(event)) {
      this.healingMap[event.ability.guid].amount += calculateEffectiveHealing(
        event,
        UNLEASH_LIFE_HEALING_INCREASE,
      );
    }
  }

  private _onRiptide(event: HealEvent) {
    const spellId = event.ability.guid;
    const targetId = event.targetID;
    //hot ticks -- the hot tracker resets attributions on refresh buff, so if a UL Riptide gets overwritten it will be excluded here
    if (event.tick) {
      if (!this.riptideTracker.hots[targetId] || !this.riptideTracker.hots[targetId][spellId]) {
        return;
      }
      const riptide = this.riptideTracker.hots[targetId][spellId];
      if (this.riptideTracker.fromUnleashLife(riptide)) {
        debug && console.log('Unleash Life Riptide Tick: ', event);
        this.healingMap[spellId].amount += calculateEffectiveHealing(
          event,
          UNLEASH_LIFE_HEALING_INCREASE,
        );
      }
      return;
    }
    // initial hit
    if (isBuffedByUnleashLife(event)) {
      debug && console.log('Unleash Life Riptide Hit: ', event);
      this.healingMap[spellId].amount += calculateEffectiveHealing(
        event,
        UNLEASH_LIFE_HEALING_INCREASE,
      );
    }
  }

  private _onHealingRain(event: CastEvent) {
    //get all the healing rain events related to this cast
    const healingRainEvents = getHealingRainEvents(event);
    healingRainEvents.forEach((event) => {
      //iterate through events grouped by tick to determine target hit count
      if (!this.countedHealingRainEvents.has(event.timestamp)) {
        this.countedHealingRainEvents.add(event.timestamp);
        const tickEvents = getHealingRainHealEventsForTick(event);
        const filteredTicks = tickEvents.splice(HEALING_RAIN_TARGETS);
        if (filteredTicks.length < UNLEASH_LIFE_EXTRA_TARGETS) {
          this.missedTicks += UNLEASH_LIFE_EXTRA_TARGETS - filteredTicks.length;
        }
        this.extraTicks += filteredTicks.length;
        this.healingRainHealing += this._tallyHealing(filteredTicks);
        this.healingMap[TALENTS.HEALING_RAIN_TALENT.id].amount += this._tallyHealing(filteredTicks);
      }
    });
    //tally additional hits from overflowing shores if talented
    if (this.overflowingShoresActive) {
      const overflowingShoresEvents = getOverflowingShoresEvents(event);
      const filteredhits = overflowingShoresEvents.splice(HEALING_RAIN_TARGETS);
      if (filteredhits.length < UNLEASH_LIFE_EXTRA_TARGETS) {
        this.missedOSTicks += UNLEASH_LIFE_EXTRA_TARGETS - filteredhits.length;
      }
      this.extraOSTicks += filteredhits.length;
      this.overflowingShoresHealing += this._tallyHealing(filteredhits);
      this.healingMap[TALENTS.HEALING_RAIN_TALENT.id].amount += this._tallyHealing(filteredhits);
    }
  }

  private _onHealingWave(event: CastEvent) {
    const ulHealingWaves = getUnleashLifeHealingWaves(event);
    if (ulHealingWaves.length > 0) {
      if (this.pwaveActive) {
        const pwHealingWaves = ulHealingWaves.filter((event) =>
          isHealingWaveFromPrimordialWave(event),
        );
        this.pwaveHealingWaveHealing += this._tallyHealingIncrease(
          pwHealingWaves,
          UNLEASH_LIFE_HEALING_INCREASE,
        );
        this.healingWaveHealing += this._tallyHealingIncrease(
          ulHealingWaves.filter((event) => !isHealingWaveFromPrimordialWave(event)),
          UNLEASH_LIFE_HEALING_INCREASE,
        );
      }
      this.healingMap[event.ability.guid].amount += this._tallyHealingIncrease(
        ulHealingWaves,
        UNLEASH_LIFE_HEALING_INCREASE,
      );
    }
  }

  private _onChainHeal(event: CastEvent) {
    const chainHealEvents = getChainHeals(event);
    if (chainHealEvents.length > 0) {
      const orderedChainHeal = this.chainHealNormalizer.normalizeChainHealOrder(chainHealEvents);
      const extraHit = orderedChainHeal.splice(orderedChainHeal.length - 1);
      this.healingMap[event.ability.guid].amount += this._tallyHealing(extraHit);
      this.healingMap[event.ability.guid].amount += this._tallyHealingIncrease(
        orderedChainHeal,
        UNLEASH_LIFE_CHAIN_HEAL_INCREASE,
      );
    }
  }

  private _onDownpour(event: CastEvent) {
    const downpourEvents = getDownPourEvents(event);
    if(downpourEvents.length > 0) {
      const filteredhits = downpourEvents.splice(DOWNPOUR_TARGETS);
      if (filteredhits.length < UNLEASH_LIFE_EXTRA_TARGETS) {
        this.missedDownpourHits += UNLEASH_LIFE_EXTRA_TARGETS - filteredhits.length;
      }
      this.extraDownpourHits += filteredhits.length;
      this.healingMap[TALENTS.DOWNPOUR_TALENT.id].amount += this._tallyHealing(filteredhits);
    }
  }

  private _tallyHealingIncrease(events: HealEvent[], healIncrease: number): number {
    if (events.length > 0) {
      return events.reduce(
        (amount, event) => amount + calculateEffectiveHealing(event, healIncrease),
        0,
      );
    }
    return 0;
  }

  private _tallyHealing(events: HealEvent[]): number {
    if (events.length > 0) {
      return events.reduce((amount, event) => amount + event.amount, 0);
    }
    return 0;
  }

  //DELETE -- FIX
  get totalBuffedHealing() {
    if (debug) {
      console.log('Wellspring Shield: ', this.healingMap[TALENTS.WELLSPRING_TALENT.id]);
      console.log('Healing Surge: ', this.healingMap[SPELLS.HEALING_SURGE.id]);
      console.log('Riptide: ', this.healingMap[TALENTS.RIPTIDE_TALENT.id]);
      console.log('Healing Wave: ', this.healingMap[TALENTS.HEALING_WAVE_TALENT.id]);
      console.log(
        'Healing Rain: ',
        this.healingMap[TALENTS.HEALING_RAIN_TALENT.id],
        'Missed Ticks: ',
        this.missedTicks,
        'Extra Ticks: ',
        this.extraTicks,
        'Extra OS Ticks: ',
        this.extraOSTicks,
      );
      console.log('Chain Heal: ', this.healingMap[TALENTS.CHAIN_HEAL_TALENT.id]);
      console.log('Downpour: ', this.healingMap[TALENTS.DOWNPOUR_TALENT.id], 'ExtraCD: ', this.additionalDownpourCD);
    }
    return Object.values(this.healingMap).reduce(
      (sum, spell) => sum + spell.amount,
      0,
    );
  }

  get additionalDownpourCD() {
    return this.extraDownpourHits * DOWNPOUR_CD_PER_HIT;
  }

  get unleashLifeCastRatioChart() {
    const items = [
      {
        color: RESTORATION_COLORS.CHAIN_HEAL,
        label: <Trans id="shaman.restoration.spell.chainHeal">Chain Heal</Trans>,
        spellId: TALENTS.CHAIN_HEAL_TALENT.id,
        value: this.healingMap[TALENTS.CHAIN_HEAL_TALENT.id].casts,
      },
      {
        color: RESTORATION_COLORS.HEALING_WAVE,
        label: <Trans id="shaman.restoration.spell.healingWave">Healing Wave</Trans>,
        spellId: TALENTS.HEALING_WAVE_TALENT.id,
        value: this.healingMap[TALENTS.HEALING_WAVE_TALENT.id].casts,
      },
      {
        color: RESTORATION_COLORS.HEALING_SURGE,
        label: <Trans id="shaman.restoration.spell.healingSurge">Healing Surge</Trans>,
        spellId: SPELLS.HEALING_SURGE.id,
        value: this.healingMap[SPELLS.HEALING_SURGE.id].casts,
      },
      {
        color: RESTORATION_COLORS.RIPTIDE,
        label: <Trans id="shaman.restoration.spell.riptide">Riptide</Trans>,
        spellId: TALENTS.RIPTIDE_TALENT.id,
        value: this.healingMap[TALENTS.RIPTIDE_TALENT.id].casts,
      },
      {
        color: RESTORATION_COLORS.HEALING_RAIN,
        label: <Trans id="shaman.restoration.spell.healing_rain">Healing Rain</Trans>,
        spellId: TALENTS.HEALING_RAIN_TALENT.id,
        value: this.healingMap[TALENTS.HEALING_RAIN_TALENT.id].casts,
      },
      {
        color: RESTORATION_COLORS.WELLSPRING,
        label: <Trans id="shaman.restoration.spell.wellspring">Wellspring</Trans>,
        spellId: TALENTS.WELLSPRING_TALENT.id,
        value: this.healingMap[TALENTS.WELLSPRING_TALENT.id].casts,
      },
      {
        color: RESTORATION_COLORS.DOWNPOUR,
        label: <Trans id="shaman.restoration.spell.downpour">Downpour</Trans>,
        spellId: TALENTS.DOWNPOUR_TALENT.id,
        value: this.healingMap[TALENTS.DOWNPOUR_TALENT.id].casts,
      },
      {
        color: RESTORATION_COLORS.UNUSED,
        label: <Trans id="shaman.restoration.unleashLife.chart.unused.label">Unused Buffs</Trans>,
        tooltip: (
          <Trans id="shaman.restoration.unleashLife.chart.unused.label.tooltip">
            The amount of Unleash Life buffs you did not use out of the total available. You cast{' '}
            {this.unleashLifeCount} Unleash Lifes, of which you used{' '}
            {this.unleashLifeCount - this.wastedBuffs}.
          </Trans>
        ),
        value: this.wastedBuffs,
      },
    ].filter((item) => item.value > 0);
    return <DonutChart items={items} />;
  }

  statistic() {
    return (
      <Statistic
        category={STATISTIC_CATEGORY.TALENTS}
        position={STATISTIC_ORDER.OPTIONAL(15)}
        size="flexible"
      >
        <div className="pad">
          <label>
            <Trans id="shaman.restoration.unleashLife.statistic.label">
              <SpellLink id={TALENTS.UNLEASH_LIFE_TALENT.id} /> usage
            </Trans>
          </label>
          {this.unleashLifeCastRatioChart}
          <small>
            {this.unleashLifeCount - this.wastedBuffs}/{this.unleashLifeCount} buffs used
          </small>
        </div>
      </Statistic>
    );
  }

  //FIX
  subStatistic() {
    return (
      <StatisticListBoxItem
        title={<SpellLink id={TALENTS.UNLEASH_LIFE_TALENT.id} />}
        value={`${formatPercentage(
          this.owner.getPercentageOfTotalHealingDone(this.directHealing + this.totalBuffedHealing),
        )} %`}
        valueTooltip={
          <Trans id="shaman.restoration.unleashLife.statistic.tooltip">
            {formatPercentage(this.owner.getPercentageOfTotalHealingDone(this.directHealing))}% from
            Unleash Life and{' '}
            {formatPercentage(this.owner.getPercentageOfTotalHealingDone(this.totalBuffedHealing))}%
            from the healing buff.
          </Trans>
        }
      />
    );
  }
}

export default UnleashLife;
