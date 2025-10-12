<script>
	import { get } from 'svelte/store';

	import { trajSettings as tSettings } from '$lib/stores/preferences';

    let settings = get(tSettings);

</script>

<div class="traj bg-background/90 dark:bg-background/70">
	<div>Duration: {settings.duration}h</div>
	<input
		id="traj_duration"
		class="w-full delay-75 duration-200  cursor-pointer"
		type="range"
		min="0"
		max="48"
		step="1"
        value = {settings.duration}
		oninput={(e) => {
				const value = e?.target?.value;
                settings.duration=value;
                tSettings.set(settings);
		}}
	/>
    <div id="traj-progress">Progress: </div>
	<div class="tip">Click on the map to start trajectory.</div>
</div>

<style>
	.traj {
        padding: 0.3em;
        border: 1px solid rgba(0,0,0,0.3);
        border-radius: 5px;
		.tip{
			font-size: 0.65em;
		}
	}
</style>
