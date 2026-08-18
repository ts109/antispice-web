export function initializeLandingPage({onEditorShown} = {}) {
    const landing = document.querySelector("#landingPage");
    const show = document.querySelector("#showLanding");
    const enter = [document.querySelector("#enterEditor"), document.querySelector("#enterEditorFooter")];

    function showLanding() {
        document.body.dataset.view = "landing";
        landing.removeAttribute("aria-hidden");
        show.setAttribute("aria-expanded", "true");
        landing.focus({preventScroll: true});
    }

    function showEditor() {
        document.body.dataset.view = "editor";
        landing.setAttribute("aria-hidden", "true");
        show.setAttribute("aria-expanded", "false");
        onEditorShown?.();
    }

    landing.tabIndex = -1;
    show.setAttribute("aria-controls", "landingPage");
    show.setAttribute("aria-expanded", "true");
    show.addEventListener("click", showLanding);
    for (const button of enter) button.addEventListener("click", showEditor);

    return {showLanding, showEditor};
}
