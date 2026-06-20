// Unit tests for the deterministic leg/day-block generator.
// Run with: npm test  (node --import tsx --test)
//
// These cover the cases the brief calls out explicitly: base_city split vs
// single producing the right leg set, region_cut removing the right leg and its
// edges, pace cadence inserting open blocks, and splurge adding/omitting the
// Douro day-trip block.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  allocateNights,
  fillRemainingDays,
  generateDayBlockSpecs,
  generateLegSpecs,
  type DecisionMap,
  type GeneratorTrip,
} from '../app/lib/legGeneration'

const TRIP: GeneratorTrip = { destination: 'Portugal', days_total: 14, pace: 'standard' }

test('base_city=split produces Lisbon + Porto with a transit edge between them', () => {
  const decisions: DecisionMap = { base_city: { stance: 'split' } }
  const { legs, edges } = generateLegSpecs(TRIP, decisions)

  assert.deepEqual(legs.map((l) => l.place), ['Lisbon', 'Porto'])
  assert.equal(edges.length, 1)
  assert.equal(edges[0].from_place, 'Lisbon')
  assert.equal(edges[0].to_place, 'Porto')
  assert.equal(edges[0].mode, 'train')
})

test('base_city=single produces Lisbon only and no edges', () => {
  const decisions: DecisionMap = { base_city: { stance: 'single' } }
  const { legs, edges } = generateLegSpecs(TRIP, decisions)

  assert.deepEqual(legs.map((l) => l.place), ['Lisbon'])
  assert.equal(edges.length, 0)
})

test('region_cut=cut_porto removes the Porto leg AND its transit edge', () => {
  const decisions: DecisionMap = {
    base_city: { stance: 'split' },
    region_cut: { stance: 'cut_porto' },
  }
  const { legs, edges } = generateLegSpecs(TRIP, decisions)

  assert.ok(!legs.some((l) => l.place === 'Porto'), 'Porto leg should be gone')
  assert.ok(legs.some((l) => l.place.startsWith('Algarve')), 'Algarve should join')
  assert.equal(edges.length, 0, 'the Lisbon→Porto edge should be removed with Porto')
})

test('region_cut=cut_algarve keeps Porto and adds Peneda-Gerês as secondary', () => {
  const decisions: DecisionMap = {
    base_city: { stance: 'split' },
    region_cut: { stance: 'cut_algarve' },
  }
  const { legs } = generateLegSpecs(TRIP, decisions)

  assert.deepEqual(
    legs.map((l) => l.place),
    ['Lisbon', 'Porto', 'Peneda-Gerês National Park']
  )
  const park = legs.find((l) => l.place.startsWith('Peneda'))!
  assert.equal(park.role, 'secondary')
})

test('allocateNights distributes the exact night total and respects minimums', () => {
  const places = [
    { place: 'Lisbon', role: 'primary' as const },
    { place: 'Porto', role: 'primary' as const },
  ]
  const result = allocateNights(places, 13)

  assert.equal(result.reduce((s, r) => s + r.nights, 0), 13, 'nights must sum to total')
  const lisbon = result.find((r) => r.place === 'Lisbon')!
  const porto = result.find((r) => r.place === 'Porto')!
  assert.ok(lisbon.nights >= 4, 'Lisbon honors its 4-night minimum')
  assert.ok(porto.nights >= 3, 'Porto honors its 3-night minimum')
  assert.ok(porto.nights <= 6, 'Porto respects its max of 6')
})

test('pace=relaxed inserts an open block roughly every 4 days; packed inserts none', () => {
  const relaxed = fillRemainingDays(8, 'relaxed')
  const openCount = relaxed.filter((b) => b.kind === 'open').length
  assert.equal(openCount, 2, '8 days relaxed → open blocks at day 4 and day 8')

  const packed = fillRemainingDays(8, 'packed')
  assert.equal(packed.filter((b) => b.kind === 'open').length, 0)
})

test('splurge_or_skip=add inserts a Douro day-trip block on the Porto leg only', () => {
  const decisions: DecisionMap = { splurge_or_skip: { stance: 'add' } }

  const portoLeg = { place: 'Porto', role: 'primary' as const, nights: 5, sequence_order: 1 }
  const portoBlocks = generateDayBlockSpecs(portoLeg, decisions, false, 'standard')
  const dayTrip = portoBlocks.find((b) => b.kind === 'day_trip')
  assert.ok(dayTrip, 'Porto leg should get a day_trip block')
  assert.equal(dayTrip!.target, 'Douro Valley')

  const lisbonLeg = { place: 'Lisbon', role: 'primary' as const, nights: 6, sequence_order: 0 }
  const lisbonBlocks = generateDayBlockSpecs(lisbonLeg, decisions, true, 'standard')
  assert.ok(
    !lisbonBlocks.some((b) => b.kind === 'day_trip'),
    'Lisbon leg should NOT host the Douro day-trip'
  )
  assert.equal(lisbonBlocks[0].kind, 'arrival', 'first leg of trip starts with an arrival block')
})

test('splurge_or_skip=skip omits the Douro day-trip block entirely', () => {
  const decisions: DecisionMap = { splurge_or_skip: { stance: 'skip' } }
  const portoLeg = { place: 'Porto', role: 'primary' as const, nights: 5, sequence_order: 1 }
  const blocks = generateDayBlockSpecs(portoLeg, decisions, false, 'standard')
  assert.ok(!blocks.some((b) => b.kind === 'day_trip'))
})

test('generation is deterministic — identical input yields identical structure', () => {
  const decisions: DecisionMap = {
    base_city: { stance: 'split' },
    region_cut: { stance: 'cut_algarve' },
  }
  const a = generateLegSpecs(TRIP, decisions)
  const b = generateLegSpecs(TRIP, decisions)
  assert.deepEqual(a, b)
})
