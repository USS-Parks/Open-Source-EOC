# Board Designer Guide

Boards are the platform's primitive: a versioned schema with input and display
views. You design them as data, with no hand-written HTML or JavaScript.

## Anatomy of a board

- **Fields** have a key, a label, and a type (text, number, boolean, datetime,
  enum, person reference, geometry). Enumerated fields are the default: where
  doctrine defines the values, users pick rather than type.
- **Views** are named column sets with optional filters and sort. An input view
  is what an editor fills; a display view is what a reader scans.
- **Version** is the schema version. Boards are versioned so an instance can
  upgrade without losing data.

## Local customization

A jurisdiction can add local fields to a board it created. Local field keys
start with `x_`. On a template upgrade, your `x_` fields and all records are
preserved; local fields the new template now covers re-converge to the
template. This is why there are no in-place-upgrade dead ends.

## The standard library

The shipped set (activity log, significant events, resource requests,
shelters, road closures, lifelines, sign-in/out, situation report, press
releases, checklists, after-action review, rumor control, talking points)
covers common needs. Start from one and adjust, or design your own.

## Publishing to other instances

Templates can be packaged and shared. Only signed packages from trusted keys
import, so a region can distribute a common board set without letting an
untrusted package redefine schemas.

See the hands-on walkthrough in
[../DESIGNER-USABILITY-SCRIPT.md](../DESIGNER-USABILITY-SCRIPT.md).
