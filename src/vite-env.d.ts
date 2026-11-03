/// <reference types="vite/client" />

declare module 'satellite.js' {
  export interface SatRec {
    satnum: string;
    epochyr: number;
    epochdays: number;
    inclination: number;
    [key: string]: unknown;
  }
  export interface Geodetic {
    longitude: number;
    latitude: number;
    height: number;
  }
  export interface EciVec3 {
    x: number;
    y: number;
    z: number;
  }
  export interface LookAngles {
    azimuth: number;
    elevation: number;
    rangeSat: number;
  }
  export function twoline2satrec(line1: string, line2: string): SatRec;
  export function propagate(satrec: SatRec, date: Date): { position: EciVec3 | false; velocity: EciVec3 | false };
  export function gstime(date: Date): number;
  export function eciToGeodetic(eci: EciVec3, gmst: number): Geodetic;
  export function degreesLat(rad: number): number;
  export function degreesLong(rad: number): number;
  export function radiansLat(deg: number): number;
  export function radiansLong(deg: number): number;
  export function ecitToEcf(eci: EciVec3, gmst: number): EciVec3;
  export function eciToEcf(eci: EciVec3, gmst: number): EciVec3;
  export function ecfToLookAngles(observer: Geodetic, ecf: EciVec3): LookAngles;
}
