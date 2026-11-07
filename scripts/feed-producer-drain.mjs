/** New-release producers already use the additive write contract. Only older
 * or unidentified executions need to drain before migration finalization. */
export function needsFeedProducerDrain(execution, releaseSha) {
  const status=execution.status??{};
  const completed=status.conditions?.find(condition=>condition.type==='Completed');
  if(status.completionTime||(completed&&completed.status!=='Unknown'))return false;
  const env=execution.spec?.template?.spec?.containers?.[0]?.env??[];
  return !releaseSha||!env.some(item=>item.name==='GIT_SHA'&&item.value===releaseSha);
}
