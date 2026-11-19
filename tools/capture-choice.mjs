// The themed, accessible composer menus replace OS select elements.
export async function chooseCapture(page, name, value) {
  const choices = {
    'Entry mode': { plan: 'Plan an activity', log: 'Log completed work' },
    'Section for new activity': { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }
  };
  const label = choices[name]?.[value];
  if (!label) throw new Error(`Unknown capture choice: ${name}/${value}`);
  const button = page.getByRole('button', { name, exact: true });
  // A late background redraw can replace the open menu; reopen it rather than wait on a detached item.
  for (let attempt = 1; ; attempt++) {
    try {
      await button.click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click({ timeout: 3000 });
      break;
    } catch (error) { if (attempt >= 4) throw error; }
  }
  if (await button.getAttribute('data-value') !== value) throw new Error('Capture choice did not update');
}
