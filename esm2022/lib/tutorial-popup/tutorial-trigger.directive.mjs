import { OverlayConfig, } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Directive, HostListener, Inject, Input, Optional, } from '@angular/core';
import { merge, of as observableOf, Subscription } from 'rxjs';
import { filter, take, takeUntil } from 'rxjs/operators';
import { MatMenu, MAT_MENU_SCROLL_STRATEGY } from '@angular/material/menu';
import { BdcDisplayEventAction } from '../bdc-walk.service';
import * as i0 from "@angular/core";
import * as i1 from "../bdc-walk.service";
import * as i2 from "@angular/cdk/overlay";
import * as i3 from "@angular/cdk/bidi";
export class BdcWalkTriggerDirective {
    /** References the popup instance that the trigger is associated with. */
    get popup() {
        return this._popup;
    }
    set popup(popup) {
        if (popup === this._popup) {
            return;
        }
        this._popup = popup;
        this._menu = popup.menu;
        this._menuCloseSubscription.unsubscribe();
        if (popup) {
            this._menuCloseSubscription = popup.menu.closed.subscribe(() => {
                this._destroyMenu();
            });
        }
    }
    constructor(tutorialService, _overlay, _element, _viewContainerRef, scrollStrategy, _dir, _ngZone) {
        this.tutorialService = tutorialService;
        this._overlay = _overlay;
        this._element = _element;
        this._viewContainerRef = _viewContainerRef;
        this._dir = _dir;
        this._ngZone = _ngZone;
        this._overlayRef = null;
        this._menuOpen = false;
        this._closingActionsSubscription = Subscription.EMPTY;
        this._hoverSubscription = Subscription.EMPTY;
        this._menuCloseSubscription = Subscription.EMPTY;
        this._initialized = false;
        this._contentInited = false;
        this._isTriggerVisible = true;
        this.enabled = true;
        this.mustCompleted = {};
        this._scrollStrategy = scrollStrategy;
    }
    ngAfterContentInit() {
        this._contentInited = true;
        this._componentSubscription = this.tutorialService.changes.subscribe(() => this._sync());
    }
    ngAfterContentChecked() {
        // detect changes if trigger visibility changed
        const isTriggerVisible = !!this._element.nativeElement.offsetParent;
        if (isTriggerVisible !== this._isTriggerVisible && this._contentInited) {
            this._isTriggerVisible = isTriggerVisible;
            this._sync();
        }
    }
    ngOnChanges() {
        if (this._contentInited) {
            this._sync();
        }
    }
    ngOnDestroy() {
        if (this._componentSubscription) {
            this._componentSubscription.unsubscribe();
        }
        // must disable auto-init and release popup so others may use it
        clearTimeout(this._timer);
        if (this._initialized) {
            this.popup.trigger = null;
            this.popup.data = null;
            this.tutorialService.setIsDisplaying(this.popup.name, false);
        }
        if (this._overlayRef) {
            this._overlayRef.dispose();
            this._overlayRef = null;
        }
        this._menuCloseSubscription.unsubscribe();
        this._closingActionsSubscription.unsubscribe();
        this._hoverSubscription.unsubscribe();
    }
    /** Whether the menu is open. */
    get menuOpen() {
        return this._menuOpen;
    }
    /** The text direction of the containing app. */
    get dir() {
        return this._dir && this._dir.value === 'rtl' ? 'rtl' : 'ltr';
    }
    /** Opens the menu. */
    openMenu() {
        const menu = this._menu;
        if (this._menuOpen || !menu) {
            return;
        }
        const overlayRef = this._createOverlay(menu);
        const overlayConfig = overlayRef.getConfig();
        const positionStrategy = overlayConfig.positionStrategy;
        this._setPosition(menu, positionStrategy);
        overlayConfig.hasBackdrop = menu.hasBackdrop;
        overlayRef.attach(this._getPortal(menu));
        if (menu.lazyContent) {
            menu.lazyContent.attach();
        }
        this._closingActionsSubscription = this._menuClosingActions().subscribe(() => this.closeMenu());
        this._initMenu(menu);
        if (menu instanceof MatMenu) {
            menu._startAnimation();
            menu._directDescendantItems.changes.pipe(takeUntil(menu.close)).subscribe(() => {
                // Re-adjust the position without locking when the amount of items
                // changes so that the overlay is allowed to pick a new optimal position.
                positionStrategy.withLockedPosition(false).reapplyLastPosition();
                positionStrategy.withLockedPosition(true);
            });
        }
    }
    /** Closes the menu. */
    closeMenu() {
        this._menu?.close.emit();
    }
    /**
     * Updates the position of the menu to ensure that it fits all options within the viewport.
     */
    updatePosition() {
        this._overlayRef?.updatePosition();
    }
    /** Closes the menu and does the necessary cleanup. */
    _destroyMenu() {
        if (!this._overlayRef || !this.menuOpen) {
            return;
        }
        const menu = this._menu;
        this._closingActionsSubscription.unsubscribe();
        this._overlayRef.detach();
        if (menu instanceof MatMenu) {
            menu._resetAnimation();
            if (menu.lazyContent) {
                // Wait for the exit animation to finish before detaching the content.
                menu._animationDone
                    .pipe(filter(event => event.toState === 'void'), take(1), 
                // Interrupt if the content got re-attached.
                takeUntil(menu.lazyContent._attached))
                    .subscribe({
                    next: () => menu.lazyContent.detach(),
                    // No matter whether the content got re-attached, reset the menu.
                    complete: () => this._setIsMenuOpen(false),
                });
            }
            else {
                this._setIsMenuOpen(false);
            }
        }
        else {
            this._setIsMenuOpen(false);
            menu?.lazyContent?.detach();
        }
    }
    /**
     * This method sets the menu state to open and focuses the first item if
     * the menu was opened via the keyboard.
     */
    _initMenu(menu) {
        menu.direction = this.dir;
        this._setIsMenuOpen(true);
    }
    // set state rather than toggle to support triggers sharing a menu
    _setIsMenuOpen(isOpen) {
        this._menuOpen = isOpen;
    }
    /**
     * This method creates the overlay from the provided menu's template and saves its
     * OverlayRef so that it can be attached to the DOM when openMenu is called.
     */
    _createOverlay(menu) {
        if (!this._overlayRef) {
            const config = this._getOverlayConfig(menu);
            this._subscribeToPositions(menu, config.positionStrategy);
            this._overlayRef = this._overlay.create(config);
        }
        return this._overlayRef;
    }
    /**
     * This method builds the configuration object needed to create the overlay, the OverlayState.
     * @returns OverlayConfig
     */
    _getOverlayConfig(menu) {
        // override overlay to avoid resizing of popups
        const positionStrategy = this._overlay.position()
            .flexibleConnectedTo(this._element)
            .withPush(true)
            .withFlexibleDimensions(false)
            .withTransformOriginOn('.mat-menu-panel, .mat-mdc-menu-panel');
        // patch positionStrategy to disable push for Y axis
        const curGetExactOverlayY = positionStrategy['_getExactOverlayY'];
        positionStrategy['_getExactOverlayY'] = (...args) => {
            const curIsPushed = positionStrategy['_isPushed'];
            positionStrategy['_isPushed'] = false;
            const value = curGetExactOverlayY.call(positionStrategy, ...args);
            positionStrategy['_isPushed'] = curIsPushed;
            return value;
        };
        return new OverlayConfig({
            positionStrategy,
            scrollStrategy: this._scrollStrategy(),
            direction: this._dir
        });
    }
    /**
     * Listens to changes in the position of the overlay and sets the correct classes
     * on the menu based on the new position. This ensures the animation origin is always
     * correct, even if a fallback position is used for the overlay.
     */
    _subscribeToPositions(menu, position) {
        if (menu.setPositionClasses) {
            position.positionChanges.subscribe(change => {
                const posX = change.connectionPair.overlayX === 'start' ? 'after' : 'before';
                const posY = change.connectionPair.overlayY === 'top' ? 'below' : 'above';
                if (!this._lastPosition || this._lastPosition.originX !== change.connectionPair.originX ||
                    this._lastPosition.originY !== change.connectionPair.originY) {
                    // selected position changed, we must run detect changes to update arrow css
                    this._lastPosition = change.connectionPair;
                    // this._ngZone.run(() => setTimeout(() => {}));
                    this._ngZone.run(() => menu.setPositionClasses(posX, posY));
                }
            });
        }
    }
    /**
     * Sets the appropriate positions on a position strategy
     * so the overlay connects with the trigger correctly.
     */
    _setPosition(menu, positionStrategy) {
        // override position strategy to support open to the sides
        let [originX, originFallbackX] = menu.xPosition === 'before' ? ['end', 'start'] : ['start', 'end'];
        const [overlayY, overlayFallbackY] = menu.yPosition === 'above' ? ['bottom', 'top'] : ['top', 'bottom'];
        let [originY, originFallbackY] = [overlayY, overlayFallbackY];
        let [overlayX, overlayFallbackX] = [originX, originFallbackX];
        // align popup's arrow to center of attached element if element size < 70
        const offsetX = this.popup.offsetX || ((this.popup.alignCenter || (this._element.nativeElement.offsetWidth < 130 &&
            this.popup.alignCenter === undefined)) && !this.popup.horizontal ? (this._element.nativeElement.offsetWidth / -2 + 29) *
            (menu.xPosition === 'before' ? 1 : -1) : 0);
        const offsetY = this.popup.offsetY || ((this.popup.alignCenter || (this._element.nativeElement.offsetHeight < 80 &&
            this.popup.alignCenter === undefined)) && this.popup.horizontal ? (this._element.nativeElement.offsetHeight / 2 - 29) *
            (menu.yPosition === 'below' ? 1 : -1) : 0);
        if (this.popup.horizontal) {
            // When the menu is a sub-menu, it should always align itself
            // to the edges of the trigger, instead of overlapping it.
            overlayFallbackX = originX = menu.xPosition === 'before' ? 'start' : 'end';
            originFallbackX = overlayX = originX === 'end' ? 'start' : 'end';
        }
        else if (!menu.overlapTrigger) {
            originY = overlayY === 'top' ? 'bottom' : 'top';
            originFallbackY = overlayFallbackY === 'top' ? 'bottom' : 'top';
        }
        const original = { originX, originY, overlayX, overlayY, offsetX, offsetY };
        const flipX = { originX: originFallbackX, originY, overlayX: overlayFallbackX, overlayY, offsetX: -offsetX, offsetY };
        const flipY = { originX, originY: originFallbackY, overlayX, overlayY: overlayFallbackY, offsetX, offsetY: -offsetY };
        const flipXY = { originX: originFallbackX, originY: originFallbackY, overlayX: overlayFallbackX, overlayY: overlayFallbackY,
            offsetX: -offsetX, offsetY: -offsetY };
        positionStrategy.withPositions(this.popup.horizontal ? [original, flipX] : [original, flipY, flipXY]);
    }
    /** Returns a stream that emits whenever an action that should close the menu occurs. */
    _menuClosingActions() {
        const backdrop = this._overlayRef.backdropClick();
        const detachments = this._overlayRef.detachments();
        const parentClose = observableOf();
        const hover = observableOf();
        return merge(backdrop, parentClose, hover, detachments);
    }
    /** Gets the portal that should be attached to the overlay. */
    _getPortal(menu) {
        // Note that we can avoid this check by keeping the portal on the menu panel.
        // While it would be cleaner, we'd have to introduce another required method on
        // `MatMenuPanel`, making it harder to consume.
        if (!this._portal || this._portal.templateRef !== menu.templateRef) {
            this._portal = new TemplatePortal(menu.templateRef, this._viewContainerRef);
        }
        return this._portal;
    }
    /// custom code
    _click() {
        // element click
        if (this._initialized && this.popup.closeOnClick) {
            this.close(false);
        }
    }
    _sync() {
        const isTriggerVisible = !!this._element.nativeElement.offsetParent;
        if (this._menu && this.popup.name) {
            if (this.enabled && isTriggerVisible && !this.tutorialService.getTaskCompleted(this.popup.name) &&
                !this.tutorialService.disabled &&
                this.tutorialService.evalMustCompleted(this.mustCompleted) &&
                this.tutorialService.evalMustCompleted(this.popup.mustCompleted) &&
                this.tutorialService.evalMustNotDisplaying(this.popup.mustNotDisplaying)) {
                // should be visible, but let's check if popup not already in use by other trigger (in table or ngFor)
                if (!this.popup.trigger) {
                    this._initialized = true;
                    this.popup.trigger = this;
                    this.popup.data = this.data;
                    clearTimeout(this._timer);
                    this._timer = setTimeout(() => this.openMenu(), 500);
                    this.tutorialService.setIsDisplaying(this.popup.name, true);
                    this.popup.opened.emit();
                }
            }
            else if (this._initialized) {
                // only close if this is our popup (initialized)
                this._initialized = false;
                this.popup.trigger = null;
                this.popup.data = null;
                clearTimeout(this._timer);
                this.closeMenu();
                this.tutorialService.setIsDisplaying(this.popup.name, false);
                this.popup.closed.emit();
            }
        }
    }
    reposition() {
        if (this._initialized && this._componentSubscription) {
            this.closeMenu();
            this.openMenu();
        }
    }
    close(buttonClicked) {
        this.tutorialService.logUserAction(this.popup.name, buttonClicked ? BdcDisplayEventAction.ButtonClicked :
            BdcDisplayEventAction.UserClosed);
        this.tutorialService.setTaskCompleted(this.popup.name);
        this.tutorialService.setTasks(this.popup.onCloseCompleteTask);
        if (buttonClicked) {
            this.tutorialService.setTasks(this.popup.onButtonCompleteTask);
        }
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "17.0.8", ngImport: i0, type: BdcWalkTriggerDirective, deps: [{ token: i1.BdcWalkService }, { token: i2.Overlay }, { token: i0.ElementRef }, { token: i0.ViewContainerRef }, { token: MAT_MENU_SCROLL_STRATEGY }, { token: i3.Directionality, optional: true }, { token: i0.NgZone }], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "17.0.8", type: BdcWalkTriggerDirective, selector: "[bdcWalkTriggerFor]", inputs: { enabled: "enabled", mustCompleted: "mustCompleted", data: "data", popup: ["bdcWalkTriggerFor", "popup"] }, host: { listeners: { "click": "_click()" } }, usesOnChanges: true, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "17.0.8", ngImport: i0, type: BdcWalkTriggerDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[bdcWalkTriggerFor]'
                }]
        }], ctorParameters: () => [{ type: i1.BdcWalkService }, { type: i2.Overlay }, { type: i0.ElementRef }, { type: i0.ViewContainerRef }, { type: undefined, decorators: [{
                    type: Inject,
                    args: [MAT_MENU_SCROLL_STRATEGY]
                }] }, { type: i3.Directionality, decorators: [{
                    type: Optional
                }] }, { type: i0.NgZone }], propDecorators: { enabled: [{
                type: Input
            }], mustCompleted: [{
                type: Input
            }], data: [{
                type: Input
            }], popup: [{
                type: Input,
                args: ['bdcWalkTriggerFor']
            }], _click: [{
                type: HostListener,
                args: ['click']
            }] } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHV0b3JpYWwtdHJpZ2dlci5kaXJlY3RpdmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9wcm9qZWN0cy9iZGMtd2Fsa3Rocm91Z2gvc3JjL2xpYi90dXRvcmlhbC1wb3B1cC90dXRvcmlhbC10cmlnZ2VyLmRpcmVjdGl2ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFDQSxPQUFPLEVBS0wsYUFBYSxHQUlkLE1BQU0sc0JBQXNCLENBQUM7QUFDOUIsT0FBTyxFQUFDLGNBQWMsRUFBQyxNQUFNLHFCQUFxQixDQUFDO0FBQ25ELE9BQU8sRUFHTCxTQUFTLEVBRUssWUFBWSxFQUMxQixNQUFNLEVBRU4sS0FBSyxFQUdMLFFBQVEsR0FJVCxNQUFNLGVBQWUsQ0FBQztBQUN2QixPQUFPLEVBQUMsS0FBSyxFQUFjLEVBQUUsSUFBSSxZQUFZLEVBQUUsWUFBWSxFQUFDLE1BQU0sTUFBTSxDQUFDO0FBQ3pFLE9BQU8sRUFBUSxNQUFNLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBQyxNQUFNLGdCQUFnQixDQUFDO0FBQzlELE9BQU8sRUFBQyxPQUFPLEVBQUUsd0JBQXdCLEVBQTZDLE1BQU0sd0JBQXdCLENBQUM7QUFFckgsT0FBTyxFQUFDLHFCQUFxQixFQUFpQixNQUFNLHFCQUFxQixDQUFDOzs7OztBQUsxRSxNQUFNLE9BQU8sdUJBQXVCO0lBb0JsQyx5RUFBeUU7SUFDekUsSUFDSSxLQUFLO1FBQ1AsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDO0lBQ3JCLENBQUM7SUFDRCxJQUFJLEtBQUssQ0FBQyxLQUE0QjtRQUNwQyxJQUFJLEtBQUssS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ3pCLE9BQU87U0FDUjtRQUVELElBQUksQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDO1FBQ3BCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsc0JBQXNCLENBQUMsV0FBVyxFQUFF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Q2pCLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztTQUNqQjtJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsYUFBc0I7UUFDMUIsSUFBSSxDQUFDLGVBQWUsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUN2RyxxQkFBcUIsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNwQyxJQUFJLENBQUMsZUFBZSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdkQsSUFBSSxDQUFDLGVBQWUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1FBRTlELElBQUksYUFBYSxFQUFFO1lBQ2pCLElBQUksQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQztTQUNoRTtJQUNILENBQUM7OEdBaFpVLHVCQUF1QixpSUFpRHhCLHdCQUF3QjtrR0FqRHZCLHVCQUF1Qjs7MkZBQXZCLHVCQUF1QjtrQkFIbkMsU0FBUzttQkFBQztvQkFDVCxRQUFRLEVBQUUscUJBQXFCO2lCQUNoQzs7MEJBa0RJLE1BQU07MkJBQUMsd0JBQXdCOzswQkFDL0IsUUFBUTs4REFsQ0YsT0FBTztzQkFBZixLQUFLO2dCQUNHLGFBQWE7c0JBQXJCLEtBQUs7Z0JBQ0csSUFBSTtzQkFBWixLQUFLO2dCQUlGLEtBQUs7c0JBRFIsS0FBSzt1QkFBQyxtQkFBbUI7Z0JBbVUxQixNQUFNO3NCQURMLFlBQVk7dUJBQUMsT0FBTyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7RGlyZWN0aW9uLCBEaXJlY3Rpb25hbGl0eX0gZnJvbSAnQGFuZ3VsYXIvY2RrL2JpZGknO1xuaW1wb3J0IHtcbiAgQ29ubmVjdGlvblBvc2l0aW9uUGFpcixcbiAgRmxleGlibGVDb25uZWN0ZWRQb3NpdGlvblN0cmF0ZWd5LFxuICBIb3Jpem9udGFsQ29ubmVjdGlvblBvcyxcbiAgT3ZlcmxheSxcbiAgT3ZlcmxheUNvbmZpZyxcbiAgT3ZlcmxheVJlZixcbiAgU2Nyb2xsU3RyYXRlZ3ksXG4gIFZlcnRpY2FsQ29ubmVjdGlvblBvcyxcbn0gZnJvbSAnQGFuZ3VsYXIvY2RrL292ZXJsYXknO1xuaW1wb3J0IHtUZW1wbGF0ZVBvcnRhbH0gZnJvbSAnQGFuZ3VsYXIvY2RrL3BvcnRhbCc7XG5pbXBvcnQge1xuICBBZnRlckNvbnRlbnRDaGVja2VkLFxuICBBZnRlckNvbnRlbnRJbml0LFxuICBEaXJlY3RpdmUsXG4gIEVsZW1lbnRSZWYsXG4gIEV2ZW50RW1pdHRlciwgSG9zdExpc3RlbmVyLFxuICBJbmplY3QsXG4gIEluamVjdGlvblRva2VuLFxuICBJbnB1dCxcbiAgTmdab25lLCBPbkNoYW5nZXMsXG4gIE9uRGVzdHJveSxcbiAgT3B0aW9uYWwsXG4gIE91dHB1dCxcbiAgU2VsZixcbiAgVmlld0NvbnRhaW5lclJlZixcbn0gZnJvbSAnQGFuZ3VsYXIvY29yZSc7XG5pbXBvcnQge21lcmdlLCBPYnNlcnZhYmxlLCBvZiBhcyBvYnNlcnZhYmxlT2YsIFN1YnNjcmlwdGlvbn0gZnJvbSAncnhqcyc7XG5pbXBvcnQge2RlbGF5LCBmaWx0ZXIsIHRha2UsIHRha2VVbnRpbH0gZnJvbSAncnhqcy9vcGVyYXRvcnMnO1xuaW1wb3J0IHtNYXRNZW51LCBNQVRfTUVOVV9TQ1JPTExfU1RSQVRFR1ksIE1hdE1lbnVQYW5lbCwgTWVudVBvc2l0aW9uWCwgTWVudVBvc2l0aW9uWX0gZnJvbSAnQGFuZ3VsYXIvbWF0ZXJpYWwvbWVudSc7XG5pbXBvcnQge0JkY1dhbGtQb3B1cENvbXBvbmVudH0gZnJvbSAnLi90dXRvcmlhbC1wb3B1cC5jb21wb25lbnQnO1xuaW1wb3J0IHtCZGNEaXNwbGF5RXZlbnRBY3Rpb24sIEJkY1dhbGtTZXJ2aWNlfSBmcm9tICcuLi9iZGMtd2Fsay5zZXJ2aWNlJztcblxuQERpcmVjdGl2ZSh7XG4gIHNlbGVjdG9yOiAnW2JkY1dhbGtUcmlnZ2VyRm9yXSdcbn0pXG5leHBvcnQgY2xhc3MgQmRjV2Fsa1RyaWdnZXJEaXJlY3RpdmUgaW1wbGVtZW50cyBPbkRlc3Ryb3ksIE9uQ2hhbmdlcywgQWZ0ZXJDb250ZW50SW5pdCwgQWZ0ZXJDb250ZW50Q2hlY2tlZCB7XG4gIHByaXZhdGUgX3BvcnRhbDogVGVtcGxhdGVQb3J0YWw7XG4gIHByaXZhdGUgX292ZXJsYXlSZWY6IE92ZXJsYXlSZWYgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfbWVudU9wZW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBfY2xvc2luZ0FjdGlvbnNTdWJzY3JpcHRpb24gPSBTdWJzY3JpcHRpb24uRU1QVFk7XG4gIHByaXZhdGUgX2hvdmVyU3Vic2NyaXB0aW9uID0gU3Vic2NyaXB0aW9uLkVNUFRZO1xuICBwcml2YXRlIF9tZW51Q2xvc2VTdWJzY3JpcHRpb24gPSBTdWJzY3JpcHRpb24uRU1QVFk7XG4gIHByaXZhdGUgX3Njcm9sbFN0cmF0ZWd5OiAoKSA9PiBTY3JvbGxTdHJhdGVneTtcblxuICBwcml2YXRlIF9jb21wb25lbnRTdWJzY3JpcHRpb246IFN1YnNjcmlwdGlvbjtcbiAgcHJpdmF0ZSBfbGFzdFBvc2l0aW9uOiBDb25uZWN0aW9uUG9zaXRpb25QYWlyO1xuICBwcml2YXRlIF9pbml0aWFsaXplZCA9IGZhbHNlO1xuICBwcml2YXRlIF90aW1lcjogYW55O1xuICBwcml2YXRlIF9jb250ZW50SW5pdGVkID0gZmFsc2U7XG4gIHByaXZhdGUgX2lzVHJpZ2dlclZpc2libGUgPSB0cnVlO1xuXG4gIEBJbnB1dCgpIGVuYWJsZWQgPSB0cnVlO1xuICBASW5wdXQoKSBtdXN0Q29tcGxldGVkOiB7IFt0YXNrTmFtZTogc3RyaW5nXTogYW55IHwgYm9vbGVhbiB9ID0ge307XG4gIEBJbnB1dCgpIGRhdGE6IGFueTtcblxuICAvKiogUmVmZXJlbmNlcyB0aGUgcG9wdXAgaW5zdGFuY2UgdGhhdCB0aGUgdHJpZ2dlciBpcyBhc3NvY2lhdGVkIHdpdGguICovXG4gIEBJbnB1dCgnYmRjV2Fsa1RyaWdnZXJGb3InKVxuICBnZXQgcG9wdXAoKTogQmRjV2Fsa1BvcHVwQ29tcG9uZW50IHtcbiAgICByZXR1cm4gdGhpcy5fcG9wdXA7XG4gIH1cbiAgc2V0IHBvcHVwKHBvcHVwOiBCZGNXYWxrUG9wdXBDb21wb25lbnQpIHtcbiAgICBpZiAocG9wdXAgPT09IHRoaXMuX3BvcHVwKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5fcG9wdXAgPSBwb3B1cDtcbiAgICB0aGlzLl9tZW51ID0gcG9wdXAubWVudTtcbiAgICB0aGlzLl9tZW51Q2xvc2VTdWJzY3JpcHRpb24udW5zdWJzY3JpYmUoKTtcblxuICAgIGlmIChwb3B1cCkge1xuICAgICAgdGhpcy5fbWVudUNsb3NlU3Vic2NyaXB0aW9uID0gcG9wdXAubWVudS5jbG9zZWQuc3Vic2NyaWJlKCgpID0+IHtcbiAgICAgICAgdGhpcy5fZGVzdHJveU1lbnUoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX21lbnU6IE1hdE1lbnVQYW5lbCB8IG51bGw7XG4gIHByaXZhdGUgX3BvcHVwOiBCZGNXYWxrUG9wdXBDb21wb25lbnQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSB0dXRvcmlhbFNlcnZpY2U6IEJkY1dhbGtTZXJ2aWNlLFxuICAgIHByaXZhdGUgX292ZXJsYXk6IE92ZXJsYXksXG4gICAgcHJpdmF0ZSBfZWxlbWVudDogRWxlbWVudFJlZjxIVE1MRWxlbWVudD4sXG4gICAgcHJpdmF0ZSBfdmlld0NvbnRhaW5lclJlZjogVmlld0NvbnRhaW5lclJlZixcbiAgICBASW5qZWN0KE1BVF9NRU5VX1NDUk9MTF9TVFJBVEVHWSkgc2Nyb2xsU3RyYXRlZ3k6IGFueSxcbiAgICBAT3B0aW9uYWwoKSBwcml2YXRlIF9kaXI6IERpcmVjdGlvbmFsaXR5LFxuICAgIHByaXZhdGUgX25nWm9uZT86IE5nWm9uZSxcbiAgKSB7XG4gICAgdGhpcy5fc2Nyb2xsU3RyYXRlZ3kgPSBzY3JvbGxTdHJhdGVneTtcbiAgfVxuXG4gIG5nQWZ0ZXJDb250ZW50SW5pdCgpIHtcbiAgICB0aGlzLl9jb250ZW50SW5pdGVkID0gdHJ1ZTtcbiAgICB0aGlzLl9jb21wb25lbnRTdWJzY3JpcHRpb24gPSB0aGlzLnR1dG9yaWFsU2VydmljZS5jaGFuZ2VzLnN1YnNjcmliZSgoKSA9PiB0aGlzLl9zeW5jKCkpO1xuICB9XG5cbiAgbmdBZnRlckNvbnRlbnRDaGVja2VkKCkge1xuICAgIC8vIGRldGVjdCBjaGFuZ2VzIGlmIHRyaWdnZXIgdmlzaWJpbGl0eSBjaGFuZ2VkXG4gICAgY29uc3QgaXNUcmlnZ2VyVmlzaWJsZSA9ICEhdGhpcy5fZWxlbWVudC5uYXRpdmVFbGVtZW50Lm9mZnNldFBhcmVudDtcblxuICAgIGlmIChpc1RyaWdnZXJWaXNpYmxlICE9PSB0aGlzLl9pc1RyaWdnZXJWaXNpYmxlICYmIHRoaXMuX2NvbnRlbnRJbml0ZWQpIHtcbiAgICAgIHRoaXMuX2lzVHJpZ2dlclZpc2libGUgPSBpc1RyaWdnZXJWaXNpYmxlO1xuICAgICAgdGhpcy5fc3luYygpO1xuICAgIH1cbiAgfVxuXG4gIG5nT25DaGFuZ2VzKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLl9jb250ZW50SW5pdGVkKSB7XG4gICAgICB0aGlzLl9zeW5jKCk7XG4gICAgfVxuICB9XG5cbiAgbmdPbkRlc3Ryb3koKSB7XG4gICAgaWYgKHRoaXMuX2NvbXBvbmVudFN1YnNjcmlwdGlvbikge1xuICAgICAgdGhpcy5fY29tcG9uZW50U3Vic2NyaXB0aW9uLnVuc3Vic2NyaWJlKCk7XG4gICAgfVxuXG4gICAgLy8gbXVzdCBkaXNhYmxlIGF1dG8taW5pdCBhbmQgcmVsZWFzZSBwb3B1cCBzbyBvdGhlcnMgbWF5IHVzZSBpdFxuICAgIGNsZWFyVGltZW91dCh0aGlzLl90aW1lcik7XG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHtcbiAgICAgIHRoaXMucG9wdXAudHJpZ2dlciA9IG51bGw7XG4gICAgICB0aGlzLnBvcHVwLmRhdGEgPSBudWxsO1xuICAgICAgdGhpcy50dXRvcmlhbFNlcnZpY2Uuc2V0SXNEaXNwbGF5aW5nKHRoaXMucG9wdXAubmFtZSwgZmFsc2UpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9vdmVybGF5UmVmKSB7XG4gICAgICB0aGlzLl9vdmVybGF5UmVmLmRpc3Bvc2UoKTtcbiAgICAgIHRoaXMuX292ZXJsYXlSZWYgPSBudWxsO1xuICAgIH1cblxuICAgIHRoaXMuX21lbnVDbG9zZVN1YnNjcmlwdGlvbi51bnN1YnNjcmliZSgpO1xuICAgIHRoaXMuX2Nsb3NpbmdBY3Rpb25zU3Vic2NyaXB0aW9uLnVuc3Vic2NyaWJlKCk7XG4gICAgdGhpcy5faG92ZXJTdWJzY3JpcHRpb24udW5zdWJzY3JpYmUoKTtcbiAgfVxuXG4gIC8qKiBXaGV0aGVyIHRoZSBtZW51IGlzIG9wZW4uICovXG4gIGdldCBtZW51T3BlbigpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5fbWVudU9wZW47XG4gIH1cblxuICAvKiogVGhlIHRleHQgZGlyZWN0aW9uIG9mIHRoZSBjb250YWluaW5nIGFwcC4gKi9cbiAgZ2V0IGRpcigpOiBEaXJlY3Rpb24ge1xuICAgIHJldHVybiB0aGlzLl9kaXIgJiYgdGhpcy5fZGlyLnZhbHVlID09PSAncnRsJyA/ICdydGwnIDogJ2x0cic7XG4gIH1cblxuICAvKiogT3BlbnMgdGhlIG1lbnUuICovXG4gIG9wZW5NZW51KCk6IHZvaWQge1xuICAgIGNvbnN0IG1lbnUgPSB0aGlzLl9tZW51O1xuXG4gICAgaWYgKHRoaXMuX21lbnVPcGVuIHx8ICFtZW51KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgb3ZlcmxheVJlZiA9IHRoaXMuX2NyZWF0ZU92ZXJsYXkobWVudSk7XG4gICAgY29uc3Qgb3ZlcmxheUNvbmZpZyA9IG92ZXJsYXlSZWYuZ2V0Q29uZmlnKCk7XG4gICAgY29uc3QgcG9zaXRpb25TdHJhdGVneSA9IG92ZXJsYXlDb25maWcucG9zaXRpb25TdHJhdGVneSBhcyBGbGV4aWJsZUNvbm5lY3RlZFBvc2l0aW9uU3RyYXRlZ3k7XG5cbiAgICB0aGlzLl9zZXRQb3NpdGlvbihtZW51LCBwb3NpdGlvblN0cmF0ZWd5KTtcbiAgICBvdmVybGF5Q29uZmlnLmhhc0JhY2tkcm9wID0gbWVudS5oYXNCYWNrZHJvcDtcbiAgICBvdmVybGF5UmVmLmF0dGFjaCh0aGlzLl9nZXRQb3J0YWwobWVudSkpO1xuXG4gICAgaWYgKG1lbnUubGF6eUNvbnRlbnQpIHtcbiAgICAgIG1lbnUubGF6eUNvbnRlbnQuYXR0YWNoKCk7XG4gICAgfVxuXG4gICAgdGhpcy5fY2xvc2luZ0FjdGlvbnNTdWJzY3JpcHRpb24gPSB0aGlzLl9tZW51Q2xvc2luZ0FjdGlvbnMoKS5zdWJzY3JpYmUoKCkgPT4gdGhpcy5jbG9zZU1lbnUoKSk7XG4gICAgdGhpcy5faW5pdE1lbnUobWVudSk7XG5cbiAgICBpZiAobWVudSBpbnN0YW5jZW9mIE1hdE1lbnUpIHtcbiAgICAgIG1lbnUuX3N0YXJ0QW5pbWF0aW9uKCk7XG4gICAgICBtZW51Ll9kaXJlY3REZXNjZW5kYW50SXRlbXMuY2hhbmdlcy5waXBlKHRha2VVbnRpbChtZW51LmNsb3NlKSkuc3Vic2NyaWJlKCgpID0+IHtcbiAgICAgICAgLy8gUmUtYWRqdXN0IHRoZSBwb3NpdGlvbiB3aXRob3V0IGxvY2tpbmcgd2hlbiB0aGUgYW1vdW50IG9mIGl0ZW1zXG4gICAgICAgIC8vIGNoYW5nZXMgc28gdGhhdCB0aGUgb3ZlcmxheSBpcyBhbGxvd2VkIHRvIHBpY2sgYSBuZXcgb3B0aW1hbCBwb3NpdGlvbi5cbiAgICAgICAgcG9zaXRpb25TdHJhdGVneS53aXRoTG9ja2VkUG9zaXRpb24oZmFsc2UpLnJlYXBwbHlMYXN0UG9zaXRpb24oKTtcbiAgICAgICAgcG9zaXRpb25TdHJhdGVneS53aXRoTG9ja2VkUG9zaXRpb24odHJ1ZSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKiogQ2xvc2VzIHRoZSBtZW51LiAqL1xuICBjbG9zZU1lbnUoKTogdm9pZCB7XG4gICAgdGhpcy5fbWVudT8uY2xvc2UuZW1pdCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZXMgdGhlIHBvc2l0aW9uIG9mIHRoZSBtZW51IHRvIGVuc3VyZSB0aGF0IGl0IGZpdHMgYWxsIG9wdGlvbnMgd2l0aGluIHRoZSB2aWV3cG9ydC5cbiAgICovXG4gIHVwZGF0ZVBvc2l0aW9uKCk6IHZvaWQge1xuICAgIHRoaXMuX292ZXJsYXlSZWY/LnVwZGF0ZVBvc2l0aW9uKCk7XG4gIH1cblxuICAvKiogQ2xvc2VzIHRoZSBtZW51IGFuZCBkb2VzIHRoZSBuZWNlc3NhcnkgY2xlYW51cC4gKi9cbiAgcHJpdmF0ZSBfZGVzdHJveU1lbnUoKSB7XG4gICAgaWYgKCF0aGlzLl9vdmVybGF5UmVmIHx8ICF0aGlzLm1lbnVPcGVuKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbWVudSA9IHRoaXMuX21lbnU7XG4gICAgdGhpcy5fY2xvc2luZ0FjdGlvbnNTdWJzY3JpcHRpb24udW5zdWJzY3JpYmUoKTtcbiAgICB0aGlzLl9vdmVybGF5UmVmLmRldGFjaCgpO1xuXG4gICAgaWYgKG1lbnUgaW5zdGFuY2VvZiBNYXRNZW51KSB7XG4gICAgICBtZW51Ll9yZXNldEFuaW1hdGlvbigpO1xuXG4gICAgICBpZiAobWVudS5sYXp5Q29udGVudCkge1xuICAgICAgICAvLyBXYWl0IGZvciB0aGUgZXhpdCBhbmltYXRpb24gdG8gZmluaXNoIGJlZm9yZSBkZXRhY2hpbmcgdGhlIGNvbnRlbnQuXG4gICAgICAgIG1lbnUuX2FuaW1hdGlvbkRvbmVcbiAgICAgICAgICAucGlwZShcbiAgICAgICAgICAgIGZpbHRlcihldmVudCA9PiBldmVudC50b1N0YXRlID09PSAndm9pZCcpLFxuICAgICAgICAgICAgdGFrZSgxKSxcbiAgICAgICAgICAgIC8vIEludGVycnVwdCBpZiB0aGUgY29udGVudCBnb3QgcmUtYXR0YWNoZWQuXG4gICAgICAgICAgICB0YWtlVW50aWwobWVudS5sYXp5Q29udGVudC5fYXR0YWNoZWQpLFxuICAgICAgICAgIClcbiAgICAgICAgICAuc3Vic2NyaWJlKHtcbiAgICAgICAgICAgIG5leHQ6ICgpID0+IG1lbnUubGF6eUNvbnRlbnQhLmRldGFjaCgpLFxuICAgICAgICAgICAgLy8gTm8gbWF0dGVyIHdoZXRoZXIgdGhlIGNvbnRlbnQgZ290IHJlLWF0dGFjaGVkLCByZXNldCB0aGUgbWVudS5cbiAgICAgICAgICAgIGNvbXBsZXRlOiAoKSA9PiB0aGlzLl9zZXRJc01lbnVPcGVuKGZhbHNlKSxcbiAgICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX3NldElzTWVudU9wZW4oZmFsc2UpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zZXRJc01lbnVPcGVuKGZhbHNlKTtcbiAgICAgIG1lbnU/LmxhenlDb250ZW50Py5kZXRhY2goKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhpcyBtZXRob2Qgc2V0cyB0aGUgbWVudSBzdGF0ZSB0byBvcGVuIGFuZCBmb2N1c2VzIHRoZSBmaXJzdCBpdGVtIGlmXG4gICAqIHRoZSBtZW51IHdhcyBvcGVuZWQgdmlhIHRoZSBrZXlib2FyZC5cbiAgICovXG4gIHByaXZhdGUgX2luaXRNZW51KG1lbnU6IE1hdE1lbnVQYW5lbCk6IHZvaWQge1xuICAgIG1lbnUuZGlyZWN0aW9uID0gdGhpcy5kaXI7XG4gICAgdGhpcy5fc2V0SXNNZW51T3Blbih0cnVlKTtcbiAgfVxuXG4gIC8vIHNldCBzdGF0ZSByYXRoZXIgdGhhbiB0b2dnbGUgdG8gc3VwcG9ydCB0cmlnZ2VycyBzaGFyaW5nIGEgbWVudVxuICBwcml2YXRlIF9zZXRJc01lbnVPcGVuKGlzT3BlbjogYm9vbGVhbik6IHZvaWQge1xuICAgIHRoaXMuX21lbnVPcGVuID0gaXNPcGVuO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgbWV0aG9kIGNyZWF0ZXMgdGhlIG92ZXJsYXkgZnJvbSB0aGUgcHJvdmlkZWQgbWVudSdzIHRlbXBsYXRlIGFuZCBzYXZlcyBpdHNcbiAgICogT3ZlcmxheVJlZiBzbyB0aGF0IGl0IGNhbiBiZSBhdHRhY2hlZCB0byB0aGUgRE9NIHdoZW4gb3Blbk1lbnUgaXMgY2FsbGVkLlxuICAgKi9cbiAgcHJpdmF0ZSBfY3JlYXRlT3ZlcmxheShtZW51OiBNYXRNZW51UGFuZWwpOiBPdmVybGF5UmVmIHtcbiAgICBpZiAoIXRoaXMuX292ZXJsYXlSZWYpIHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuX2dldE92ZXJsYXlDb25maWcobWVudSk7XG4gICAgICB0aGlzLl9zdWJzY3JpYmVUb1Bvc2l0aW9ucyhcbiAgICAgICAgbWVudSxcbiAgICAgICAgY29uZmlnLnBvc2l0aW9uU3RyYXRlZ3kgYXMgRmxleGlibGVDb25uZWN0ZWRQb3NpdGlvblN0cmF0ZWd5LFxuICAgICAgKTtcbiAgICAgIHRoaXMuX292ZXJsYXlSZWYgPSB0aGlzLl9vdmVybGF5LmNyZWF0ZShjb25maWcpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9vdmVybGF5UmVmO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgbWV0aG9kIGJ1aWxkcyB0aGUgY29uZmlndXJhdGlvbiBvYmplY3QgbmVlZGVkIHRvIGNyZWF0ZSB0aGUgb3ZlcmxheSwgdGhlIE92ZXJsYXlTdGF0ZS5cbiAgICogQHJldHVybnMgT3ZlcmxheUNvbmZpZ1xuICAgKi9cbiAgcHJpdmF0ZSBfZ2V0T3ZlcmxheUNvbmZpZyhtZW51OiBNYXRNZW51UGFuZWwpOiBPdmVybGF5Q29uZmlnIHtcbiAgICAvLyBvdmVycmlkZSBvdmVybGF5IHRvIGF2b2lkIHJlc2l6aW5nIG9mIHBvcHVwc1xuICAgIGNvbnN0IHBvc2l0aW9uU3RyYXRlZ3kgPSB0aGlzLl9vdmVybGF5LnBvc2l0aW9uKClcbiAgICAgIC5mbGV4aWJsZUNvbm5lY3RlZFRvKHRoaXMuX2VsZW1lbnQpXG4gICAgICAud2l0aFB1c2godHJ1ZSlcbiAgICAgIC53aXRoRmxleGlibGVEaW1lbnNpb25zKGZhbHNlKVxuICAgICAgLndpdGhUcmFuc2Zvcm1PcmlnaW5PbignLm1hdC1tZW51LXBhbmVsLCAubWF0LW1kYy1tZW51LXBhbmVsJyk7XG5cbiAgICAvLyBwYXRjaCBwb3NpdGlvblN0cmF0ZWd5IHRvIGRpc2FibGUgcHVzaCBmb3IgWSBheGlzXG4gICAgY29uc3QgY3VyR2V0RXhhY3RPdmVybGF5WSA9IHBvc2l0aW9uU3RyYXRlZ3lbJ19nZXRFeGFjdE92ZXJsYXlZJ107XG5cbiAgICBwb3NpdGlvblN0cmF0ZWd5WydfZ2V0RXhhY3RPdmVybGF5WSddID0gKC4uLmFyZ3MpID0+IHtcbiAgICAgIGNvbnN0IGN1cklzUHVzaGVkID0gcG9zaXRpb25TdHJhdGVneVsnX2lzUHVzaGVkJ107XG4gICAgICBwb3NpdGlvblN0cmF0ZWd5WydfaXNQdXNoZWQnXSA9IGZhbHNlO1xuICAgICAgY29uc3QgdmFsdWUgPSBjdXJHZXRFeGFjdE92ZXJsYXlZLmNhbGwocG9zaXRpb25TdHJhdGVneSwgLi4uYXJncyk7XG4gICAgICBwb3NpdGlvblN0cmF0ZWd5WydfaXNQdXNoZWQnXSA9IGN1cklzUHVzaGVkO1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH07XG5cbiAgICByZXR1cm4gbmV3IE92ZXJsYXlDb25maWcoe1xuICAgICAgcG9zaXRpb25TdHJhdGVneSxcbiAgICAgIHNjcm9sbFN0cmF0ZWd5OiB0aGlzLl9zY3JvbGxTdHJhdGVneSgpLFxuICAgICAgZGlyZWN0aW9uOiB0aGlzLl9kaXJcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0ZW5zIHRvIGNoYW5nZXMgaW4gdGhlIHBvc2l0aW9uIG9mIHRoZSBvdmVybGF5IGFuZCBzZXRzIHRoZSBjb3JyZWN0IGNsYXNzZXNcbiAgICogb24gdGhlIG1lbnUgYmFzZWQgb24gdGhlIG5ldyBwb3NpdGlvbi4gVGhpcyBlbnN1cmVzIHRoZSBhbmltYXRpb24gb3JpZ2luIGlzIGFsd2F5c1xuICAgKiBjb3JyZWN0LCBldmVuIGlmIGEgZmFsbGJhY2sgcG9zaXRpb24gaXMgdXNlZCBmb3IgdGhlIG92ZXJsYXkuXG4gICAqL1xuICBwcml2YXRlIF9zdWJzY3JpYmVUb1Bvc2l0aW9ucyhtZW51OiBNYXRNZW51UGFuZWwsIHBvc2l0aW9uOiBGbGV4aWJsZUNvbm5lY3RlZFBvc2l0aW9uU3RyYXRlZ3kpIHtcbiAgICBpZiAobWVudS5zZXRQb3NpdGlvbkNsYXNzZXMpIHtcbiAgICAgIHBvc2l0aW9uLnBvc2l0aW9uQ2hhbmdlcy5zdWJzY3JpYmUoY2hhbmdlID0+IHtcbiAgICAgICAgY29uc3QgcG9zWDogTWVudVBvc2l0aW9uWCA9IGNoYW5nZS5jb25uZWN0aW9uUGFpci5vdmVybGF5WCA9PT0gJ3N0YXJ0JyA/ICdhZnRlcicgOiAnYmVmb3JlJztcbiAgICAgICAgY29uc3QgcG9zWTogTWVudVBvc2l0aW9uWSA9IGNoYW5nZS5jb25uZWN0aW9uUGFpci5vdmVybGF5WSA9PT0gJ3RvcCcgPyAnYmVsb3cnIDogJ2Fib3ZlJztcblxuICAgICAgICBpZiAoIXRoaXMuX2xhc3RQb3NpdGlvbiB8fCB0aGlzLl9sYXN0UG9zaXRpb24ub3JpZ2luWCAhPT0gY2hhbmdlLmNvbm5lY3Rpb25QYWlyLm9yaWdpblggfHxcbiAgICAgICAgICB0aGlzLl9sYXN0UG9zaXRpb24ub3JpZ2luWSAhPT0gY2hhbmdlLmNvbm5lY3Rpb25QYWlyLm9yaWdpblkpIHtcbiAgICAgICAgICAvLyBzZWxlY3RlZCBwb3NpdGlvbiBjaGFuZ2VkLCB3ZSBtdXN0IHJ1biBkZXRlY3QgY2hhbmdlcyB0byB1cGRhdGUgYXJyb3cgY3NzXG4gICAgICAgICAgdGhpcy5fbGFzdFBvc2l0aW9uID0gY2hhbmdlLmNvbm5lY3Rpb25QYWlyO1xuICAgICAgICAgIC8vIHRoaXMuX25nWm9uZS5ydW4oKCkgPT4gc2V0VGltZW91dCgoKSA9PiB7fSkpO1xuICAgICAgICAgIHRoaXMuX25nWm9uZS5ydW4oKCkgPT4gbWVudS5zZXRQb3NpdGlvbkNsYXNzZXMocG9zWCwgcG9zWSkpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgYXBwcm9wcmlhdGUgcG9zaXRpb25zIG9uIGEgcG9zaXRpb24gc3RyYXRlZ3lcbiAgICogc28gdGhlIG92ZXJsYXkgY29ubmVjdHMgd2l0aCB0aGUgdHJpZ2dlciBjb3JyZWN0bHkuXG4gICAqL1xuICBwcml2YXRlIF9zZXRQb3NpdGlvbihtZW51OiBNYXRNZW51UGFuZWwsIHBvc2l0aW9uU3RyYXRlZ3k6IEZsZXhpYmxlQ29ubmVjdGVkUG9zaXRpb25TdHJhdGVneSkge1xuICAgIC8vIG92ZXJyaWRlIHBvc2l0aW9uIHN0cmF0ZWd5IHRvIHN1cHBvcnQgb3BlbiB0byB0aGUgc2lkZXNcbiAgICBsZXQgW29yaWdpblgsIG9yaWdpbkZhbGxiYWNrWF06IEhvcml6b250YWxDb25uZWN0aW9uUG9zW10gPVxuICAgICAgbWVudS54UG9zaXRpb24gPT09ICdiZWZvcmUnID8gWydlbmQnLCAnc3RhcnQnXSA6IFsnc3RhcnQnLCAnZW5kJ107XG5cbiAgICBjb25zdCBbb3ZlcmxheVksIG92ZXJsYXlGYWxsYmFja1ldOiBWZXJ0aWNhbENvbm5lY3Rpb25Qb3NbXSA9XG4gICAgICBtZW51LnlQb3NpdGlvbiA9PT0gJ2Fib3ZlJyA/IFsnYm90dG9tJywgJ3RvcCddIDogWyd0b3AnLCAnYm90dG9tJ107XG5cbiAgICBsZXQgW29yaWdpblksIG9yaWdpbkZhbGxiYWNrWV0gPSBbb3ZlcmxheVksIG92ZXJsYXlGYWxsYmFja1ldO1xuICAgIGxldCBbb3ZlcmxheVgsIG92ZXJsYXlGYWxsYmFja1hdID0gW29yaWdpblgsIG9yaWdpbkZhbGxiYWNrWF07XG5cbiAgICAvLyBhbGlnbiBwb3B1cCdzIGFycm93IHRvIGNlbnRlciBvZiBhdHRhY2hlZCBlbGVtZW50IGlmIGVsZW1lbnQgc2l6ZSA8IDcwXG4gICAgY29uc3Qgb2Zmc2V0WCA9IHRoaXMucG9wdXAub2Zmc2V0WCB8fCAoKHRoaXMucG9wdXAuYWxpZ25DZW50ZXIgfHwgKHRoaXMuX2VsZW1lbnQubmF0aXZlRWxlbWVudC5vZmZzZXRXaWR0aCA8IDEzMCAmJlxuICAgICAgdGhpcy5wb3B1cC5hbGlnbkNlbnRlciA9PT0gdW5kZWZpbmVkKSkgJiYgIXRoaXMucG9wdXAuaG9yaXpvbnRhbCA/ICh0aGlzLl9lbGVtZW50Lm5hdGl2ZUVsZW1lbnQub2Zmc2V0V2lkdGggLyAtMiArIDI5KSAqXG4gICAgICAobWVudS54UG9zaXRpb24gPT09ICdiZWZvcmUnID8gMSA6IC0xKSA6IDApO1xuXG4gICAgY29uc3Qgb2Zmc2V0WSA9IHRoaXMucG9wdXAub2Zmc2V0WSB8fCAoKHRoaXMucG9wdXAuYWxpZ25DZW50ZXIgfHwgKHRoaXMuX2VsZW1lbnQubmF0aXZlRWxlbWVudC5vZmZzZXRIZWlnaHQgPCA4MCAmJlxuICAgICAgdGhpcy5wb3B1cC5hbGlnbkNlbnRlciA9PT0gdW5kZWZpbmVkKSkgJiYgdGhpcy5wb3B1cC5ob3Jpem9udGFsID8gKHRoaXMuX2VsZW1lbnQubmF0aXZlRWxlbWVudC5vZmZzZXRIZWlnaHQgLyAyIC0gMjkpICpcbiAgICAgIChtZW51LnlQb3NpdGlvbiA9PT0gJ2JlbG93JyA/IDEgOiAtMSkgOiAwKTtcblxuICAgIGlmICh0aGlzLnBvcHVwLmhvcml6b250YWwpIHtcbiAgICAgIC8vIFdoZW4gdGhlIG1lbnUgaXMgYSBzdWItbWVudSwgaXQgc2hvdWxkIGFsd2F5cyBhbGlnbiBpdHNlbGZcbiAgICAgIC8vIHRvIHRoZSBlZGdlcyBvZiB0aGUgdHJpZ2dlciwgaW5zdGVhZCBvZiBvdmVybGFwcGluZyBpdC5cbiAgICAgIG92ZXJsYXlGYWxsYmFja1ggPSBvcmlnaW5YID0gbWVudS54UG9zaXRpb24gPT09ICdiZWZvcmUnID8gJ3N0YXJ0JyA6ICdlbmQnO1xuICAgICAgb3JpZ2luRmFsbGJhY2tYID0gb3ZlcmxheVggPSBvcmlnaW5YID09PSAnZW5kJyA/ICdzdGFydCcgOiAnZW5kJztcbiAgICB9IGVsc2UgaWYgKCFtZW51Lm92ZXJsYXBUcmlnZ2VyKSB7XG4gICAgICBvcmlnaW5ZID0gb3ZlcmxheVkgPT09ICd0b3AnID8gJ2JvdHRvbScgOiAndG9wJztcbiAgICAgIG9yaWdpbkZhbGxiYWNrWSA9IG92ZXJsYXlGYWxsYmFja1kgPT09ICd0b3AnID8gJ2JvdHRvbScgOiAndG9wJztcbiAgICB9XG5cbiAgICBjb25zdCBvcmlnaW5hbCA9IHtvcmlnaW5YLCBvcmlnaW5ZLCBvdmVybGF5WCwgb3ZlcmxheVksIG9mZnNldFgsIG9mZnNldFl9O1xuICAgIGNvbnN0IGZsaXBYID0ge29yaWdpblg6IG9yaWdpbkZhbGxiYWNrWCwgb3JpZ2luWSwgb3ZlcmxheVg6IG92ZXJsYXlGYWxsYmFja1gsIG92ZXJsYXlZLCBvZmZzZXRYOiAtb2Zmc2V0WCwgb2Zmc2V0WX07XG4gICAgY29uc3QgZmxpcFkgPSB7b3JpZ2luWCwgb3JpZ2luWTogb3JpZ2luRmFsbGJhY2tZLCBvdmVybGF5WCwgb3ZlcmxheVk6IG92ZXJsYXlGYWxsYmFja1ksIG9mZnNldFgsIG9mZnNldFk6IC1vZmZzZXRZfTtcbiAgICBjb25zdCBmbGlwWFkgPSB7b3JpZ2luWDogb3JpZ2luRmFsbGJhY2tYLCBvcmlnaW5ZOiBvcmlnaW5GYWxsYmFja1ksIG92ZXJsYXlYOiBvdmVybGF5RmFsbGJhY2tYLCBvdmVybGF5WTogb3ZlcmxheUZhbGxiYWNrWSxcbiAgICAgIG9mZnNldFg6IC1vZmZzZXRYLCBvZmZzZXRZOiAtb2Zmc2V0WX07XG5cbiAgICBwb3NpdGlvblN0cmF0ZWd5LndpdGhQb3NpdGlvbnModGhpcy5wb3B1cC5ob3Jpem9udGFsID8gW29yaWdpbmFsLCBmbGlwWF0gOiBbb3JpZ2luYWwsIGZsaXBZLCBmbGlwWFldKTtcbiAgfVxuXG4gIC8qKiBSZXR1cm5zIGEgc3RyZWFtIHRoYXQgZW1pdHMgd2hlbmV2ZXIgYW4gYWN0aW9uIHRoYXQgc2hvdWxkIGNsb3NlIHRoZSBtZW51IG9jY3Vycy4gKi9cbiAgcHJpdmF0ZSBfbWVudUNsb3NpbmdBY3Rpb25zKCkge1xuICAgIGNvbnN0IGJhY2tkcm9wID0gdGhpcy5fb3ZlcmxheVJlZiEuYmFja2Ryb3BDbGljaygpO1xuICAgIGNvbnN0IGRldGFjaG1lbnRzID0gdGhpcy5fb3ZlcmxheVJlZiEuZGV0YWNobWVudHMoKTtcbiAgICBjb25zdCBwYXJlbnRDbG9zZSA9IG9ic2VydmFibGVPZigpO1xuICAgIGNvbnN0IGhvdmVyID0gb2JzZXJ2YWJsZU9mKCk7XG5cbiAgICByZXR1cm4gbWVyZ2UoYmFja2Ryb3AsIHBhcmVudENsb3NlIGFzIE9ic2VydmFibGU8dm9pZD4sIGhvdmVyLCBkZXRhY2htZW50cyk7XG4gIH1cblxuICAvKiogR2V0cyB0aGUgcG9ydGFsIHRoYXQgc2hvdWxkIGJlIGF0dGFjaGVkIHRvIHRoZSBvdmVybGF5LiAqL1xuICBwcml2YXRlIF9nZXRQb3J0YWwobWVudTogTWF0TWVudVBhbmVsKTogVGVtcGxhdGVQb3J0YWwge1xuICAgIC8vIE5vdGUgdGhhdCB3ZSBjYW4gYXZvaWQgdGhpcyBjaGVjayBieSBrZWVwaW5nIHRoZSBwb3J0YWwgb24gdGhlIG1lbnUgcGFuZWwuXG4gICAgLy8gV2hpbGUgaXQgd291bGQgYmUgY2xlYW5lciwgd2UnZCBoYXZlIHRvIGludHJvZHVjZSBhbm90aGVyIHJlcXVpcmVkIG1ldGhvZCBvblxuICAgIC8vIGBNYXRNZW51UGFuZWxgLCBtYWtpbmcgaXQgaGFyZGVyIHRvIGNvbnN1bWUuXG4gICAgaWYgKCF0aGlzLl9wb3J0YWwgfHwgdGhpcy5fcG9ydGFsLnRlbXBsYXRlUmVmICE9PSBtZW51LnRlbXBsYXRlUmVmKSB7XG4gICAgICB0aGlzLl9wb3J0YWwgPSBuZXcgVGVtcGxhdGVQb3J0YWwobWVudS50ZW1wbGF0ZVJlZiwgdGhpcy5fdmlld0NvbnRhaW5lclJlZik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3BvcnRhbDtcbiAgfVxuXG4gIC8vLyBjdXN0b20gY29kZVxuXG4gIEBIb3N0TGlzdGVuZXIoJ2NsaWNrJylcbiAgX2NsaWNrKCkge1xuICAgIC8vIGVsZW1lbnQgY2xpY2tcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQgJiYgdGhpcy5wb3B1cC5jbG9zZU9uQ2xpY2spIHtcbiAgICAgIHRoaXMuY2xvc2UoZmFsc2UpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX3N5bmMoKSB7XG4gICAgY29uc3QgaXNUcmlnZ2VyVmlzaWJsZSA9ICEhdGhpcy5fZWxlbWVudC5uYXRpdmVFbGVtZW50Lm9mZnNldFBhcmVudDtcblxuICAgIGlmICh0aGlzLl9tZW51ICYmIHRoaXMucG9wdXAubmFtZSkge1xuICAgICAgaWYgKHRoaXMuZW5hYmxlZCAmJiBpc1RyaWdnZXJWaXNpYmxlICYmICF0aGlzLnR1dG9yaWFsU2VydmljZS5nZXRUYXNrQ29tcGxldGVkKHRoaXMucG9wdXAubmFtZSkgJiZcbiAgICAgICAgIXRoaXMudHV0b3JpYWxTZXJ2aWNlLmRpc2FibGVkICYmXG4gICAgICAgIHRoaXMudHV0b3JpYWxTZXJ2aWNlLmV2YWxNdXN0Q29tcGxldGVkKHRoaXMubXVzdENvbXBsZXRlZCkgJiZcbiAgICAgICAgdGhpcy50dXRvcmlhbFNlcnZpY2UuZXZhbE11c3RDb21wbGV0ZWQodGhpcy5wb3B1cC5tdXN0Q29tcGxldGVkKSAmJlxuICAgICAgICB0aGlzLnR1dG9yaWFsU2VydmljZS5ldmFsTXVzdE5vdERpc3BsYXlpbmcodGhpcy5wb3B1cC5tdXN0Tm90RGlzcGxheWluZykpIHtcblxuICAgICAgICAvLyBzaG91bGQgYmUgdmlzaWJsZSwgYnV0IGxldCdzIGNoZWNrIGlmIHBvcHVwIG5vdCBhbHJlYWR5IGluIHVzZSBieSBvdGhlciB0cmlnZ2VyIChpbiB0YWJsZSBvciBuZ0ZvcilcbiAgICAgICAgaWYgKCF0aGlzLnBvcHVwLnRyaWdnZXIpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgdGhpcy5wb3B1cC50cmlnZ2VyID0gdGhpcztcbiAgICAgICAgICB0aGlzLnBvcHVwLmRhdGEgPSB0aGlzLmRhdGE7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpbWVyKTtcbiAgICAgICAgICB0aGlzLl90aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5vcGVuTWVudSgpLCA1MDApO1xuICAgICAgICAgIHRoaXMudHV0b3JpYWxTZXJ2aWNlLnNldElzRGlzcGxheWluZyh0aGlzLnBvcHVwLm5hbWUsIHRydWUpO1xuICAgICAgICAgIHRoaXMucG9wdXAub3BlbmVkLmVtaXQoKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh0aGlzLl9pbml0aWFsaXplZCkge1xuICAgICAgICAvLyBvbmx5IGNsb3NlIGlmIHRoaXMgaXMgb3VyIHBvcHVwIChpbml0aWFsaXplZClcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5wb3B1cC50cmlnZ2VyID0gbnVsbDtcbiAgICAgICAgdGhpcy5wb3B1cC5kYXRhID0gbnVsbDtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpbWVyKTtcbiAgICAgICAgdGhpcy5jbG9zZU1lbnUoKTtcbiAgICAgICAgdGhpcy50dXRvcmlhbFNlcnZpY2Uuc2V0SXNEaXNwbGF5aW5nKHRoaXMucG9wdXAubmFtZSwgZmFsc2UpO1xuICAgICAgICB0aGlzLnBvcHVwLmNsb3NlZC5lbWl0KCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmVwb3NpdGlvbigpIHtcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQgJiYgdGhpcy5fY29tcG9uZW50U3Vic2NyaXB0aW9uKSB7XG4gICAgICB0aGlzLmNsb3NlTWVudSgpO1xuICAgICAgdGhpcy5vcGVuTWVudSgpO1xuICAgIH1cbiAgfVxuXG4gIGNsb3NlKGJ1dHRvbkNsaWNrZWQ6IGJvb2xlYW4pIHtcbiAgICB0aGlzLnR1dG9yaWFsU2VydmljZS5sb2dVc2VyQWN0aW9uKHRoaXMucG9wdXAubmFtZSwgYnV0dG9uQ2xpY2tlZCA/IEJkY0Rpc3BsYXlFdmVudEFjdGlvbi5CdXR0b25DbGlja2VkIDpcbiAgICAgIEJkY0Rpc3BsYXlFdmVudEFjdGlvbi5Vc2VyQ2xvc2VkKTtcbiAgICB0aGlzLnR1dG9yaWFsU2VydmljZS5zZXRUYXNrQ29tcGxldGVkKHRoaXMucG9wdXAubmFtZSk7XG4gICAgdGhpcy50dXRvcmlhbFNlcnZpY2Uuc2V0VGFza3ModGhpcy5wb3B1cC5vbkNsb3NlQ29tcGxldGVUYXNrKTtcblxuICAgIGlmIChidXR0b25DbGlja2VkKSB7XG4gICAgICB0aGlzLnR1dG9yaWFsU2VydmljZS5zZXRUYXNrcyh0aGlzLnBvcHVwLm9uQnV0dG9uQ29tcGxldGVUYXNrKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==