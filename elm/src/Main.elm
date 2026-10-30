module Main exposing (Model, Msg(..), init, main, update, view)

import Browser
import Browser.Navigation as Navigation
import Html exposing (Html, a, button, div, form, header, input, main_, p, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, href, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Git as Git
import Hunker.Domain.Settings as Settings exposing (SettingsDocument, Visibility(..))
import Hunker.Effect as Effect exposing (Effect)
import Hunker.Page.Home as Home
import Hunker.Page.Repository as Repository
import Hunker.Page.Review as Review
import Hunker.Page.Settings as SettingsPage
import Hunker.Route as Route exposing (Route)
import Hunker.Settings.Sync as SettingsSync
import Url exposing (Url)


type AppState
    = Booting Route
    | BootFailed Route ApiError
    | Ready SettingsSync.Sync Page


type Page
    = HomePage Home.Model
    | SettingsPage SettingsPage.Model
    | RepositoryPage Repository.Model
    | ReviewPage Review.Model
    | NotFoundPage String


{-| The pasted-URL field: a draft, or a draft the router rejected.
-}
type GithubInput
    = Editing String
    | Rejected String Route.GithubInputError


type alias Model =
    { state : AppState
    , githubInput : GithubInput
    }


type alias RuntimeModel =
    { key : Navigation.Key
    , app : Model
    }


type Msg
    = LinkClicked Browser.UrlRequest
    | UrlChanged Url
    | SettingsLoaded SettingsDocument
    | SettingsLoadFailed ApiError
    | SettingsSaved SettingsSync.Revision SettingsDocument
    | SettingsSaveFailed SettingsSync.Revision ApiError
    | RetriedBootstrap
    | RetriedSettingsSave
    | ChangedGitHubInput String
    | SubmittedGitHubInput
    | ChangedTopBar Visibility
    | TopBarFocusSettled
    | HomeMsg Home.Msg
    | SettingsMsg SettingsPage.Msg
    | RepositoryMsg Repository.Msg
    | ReviewMsg Review.Msg


main : Program () RuntimeModel Msg
main =
    Browser.application
        { init = runtimeInit
        , onUrlChange = UrlChanged
        , onUrlRequest = LinkClicked
        , subscriptions = .app >> subscriptions
        , update = runtimeUpdate
        , view = .app >> view
        }


init : () -> Url -> ignoredKey -> ( Model, Effect Msg )
init _ url _ =
    ( { state = Booting (Route.fromUrl url), githubInput = Editing "" }
    , Api.loadSettings SettingsLoaded SettingsLoadFailed
    )


runtimeInit : () -> Url -> Navigation.Key -> ( RuntimeModel, Cmd Msg )
runtimeInit flags url key =
    let
        ( app, effect ) =
            init flags url ()
    in
    ( { key = key, app = app }, Effect.perform key effect )


runtimeUpdate : Msg -> RuntimeModel -> ( RuntimeModel, Cmd Msg )
runtimeUpdate msg runtime =
    let
        ( app, effect ) =
            update msg runtime.app
    in
    ( { runtime | app = app }, Effect.perform runtime.key effect )


subscriptions : Model -> Sub Msg
subscriptions model =
    case model.state of
        Ready _ (RepositoryPage repository) ->
            Sub.map RepositoryMsg (Repository.subscriptions repository)

        Ready _ (ReviewPage review) ->
            Sub.map ReviewMsg (Review.subscriptions review)

        Ready _ (HomePage _) ->
            Sub.none

        Ready _ (SettingsPage _) ->
            Sub.none

        Ready _ (NotFoundPage _) ->
            Sub.none

        Booting _ ->
            Sub.none

        BootFailed _ _ ->
            Sub.none


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case ( msg, model.state ) of
        ( LinkClicked (Browser.Internal url), _ ) ->
            ( model, Effect.PushUrl (Url.toString url) )

        ( LinkClicked (Browser.External url), _ ) ->
            ( model, Effect.LoadExternal url )

        ( UrlChanged url, Ready sync page ) ->
            enterRoute sync (Route.fromUrl url) (Just page) model

        ( UrlChanged url, BootFailed _ error ) ->
            ( { model | state = BootFailed (Route.fromUrl url) error }, Effect.none )

        ( UrlChanged url, Booting _ ) ->
            ( { model | state = Booting (Route.fromUrl url) }, Effect.none )

        ( SettingsLoaded document, Booting route ) ->
            enterRoute (SettingsSync.loaded document) route Nothing model

        ( SettingsLoaded document, BootFailed route _ ) ->
            enterRoute (SettingsSync.loaded document) route Nothing model

        ( SettingsLoadFailed error, Booting route ) ->
            ( { model | state = BootFailed route error }, Effect.none )

        ( SettingsSaved revision document, Ready sync page ) ->
            applySettingsTransition page model (SettingsSync.saved revision document sync)

        ( SettingsSaveFailed revision error, Ready sync page ) ->
            ( { model | state = Ready (SettingsSync.failed revision error sync) page }, Effect.none )

        ( RetriedBootstrap, BootFailed route _ ) ->
            ( { model | state = Booting route }, Api.loadSettings SettingsLoaded SettingsLoadFailed )

        ( RetriedSettingsSave, Ready sync page ) ->
            applySettingsTransition page model (SettingsSync.queue (SettingsSync.value sync) sync)

        ( ChangedGitHubInput draft, _ ) ->
            ( { model | githubInput = Editing draft }, Effect.none )

        ( SubmittedGitHubInput, _ ) ->
            let
                draft =
                    githubDraft model.githubInput
            in
            case Route.fromGithubString (String.trim draft) of
                Ok route ->
                    ( { model | githubInput = Editing draft }, Effect.PushUrl (Route.toPath route) )

                Err error ->
                    ( { model | githubInput = Rejected draft error }, Effect.none )

        ( ChangedTopBar visibility, Ready _ _ ) ->
            queueChanges [ Settings.SetTopBar visibility ] model
                |> addEffect
                    (Effect.Focus
                        (case visibility of
                            Collapsed ->
                                "show-top-bar"

                            Expanded ->
                                "hide-top-bar"
                        )
                        TopBarFocusSettled
                    )

        ( TopBarFocusSettled, _ ) ->
            unchanged model

        ( HomeMsg message, Ready sync (HomePage home) ) ->
            Home.update message home |> mapPage HomePage HomeMsg sync model

        ( SettingsMsg message, Ready sync (SettingsPage settingsPage) ) ->
            let
                ( updated, changes ) =
                    SettingsPage.update message settingsPage
            in
            queueChanges changes { model | state = Ready sync (SettingsPage updated) }

        ( RepositoryMsg message, Ready sync (RepositoryPage repository) ) ->
            Repository.update message repository |> mapPage RepositoryPage RepositoryMsg sync model

        ( ReviewMsg message, Ready sync (ReviewPage review) ) ->
            let
                ( updated, effect, changes ) =
                    Review.update (SettingsSync.value sync) message review
            in
            queueChanges changes { model | state = Ready sync (ReviewPage updated) }
                |> addEffect (Effect.map ReviewMsg effect)

        -- Everything else is a response or message for a state that has since
        -- been replaced: a page message after navigating away, or a settings
        -- or boot response that arrives outside its state.
        _ ->
            unchanged model


githubDraft : GithubInput -> String
githubDraft input =
    case input of
        Editing draft ->
            draft

        Rejected draft _ ->
            draft


mapPage : (childModel -> Page) -> (childMsg -> Msg) -> SettingsSync.Sync -> Model -> ( childModel, Effect childMsg ) -> ( Model, Effect Msg )
mapPage toPage toMsg sync model ( childModel, childEffect ) =
    ( { model | state = Ready sync (toPage childModel) }, Effect.map toMsg childEffect )


{-| The single route transition for cold loads, history moves, and pasted
URLs. A route for the page already shown navigates within it.
-}
enterRoute : SettingsSync.Sync -> Route -> Maybe Page -> Model -> ( Model, Effect Msg )
enterRoute sync route current model =
    case ( route, current ) of
        ( Route.Review location, Just (ReviewPage review) ) ->
            Review.navigate location review |> mapPage ReviewPage ReviewMsg sync model

        ( Route.Repository location, Just (RepositoryPage repository) ) ->
            Repository.navigate location repository |> mapPage RepositoryPage RepositoryMsg sync model

        ( Route.Review location, _ ) ->
            Review.init location |> mapPage ReviewPage ReviewMsg sync model

        ( Route.Repository location, _ ) ->
            Repository.init location |> mapPage RepositoryPage RepositoryMsg sync model

        ( Route.Home, _ ) ->
            Home.init |> mapPage HomePage HomeMsg sync model

        ( Route.Settings, _ ) ->
            ( { model | state = Ready sync (SettingsPage SettingsPage.init) }, Effect.none )

        ( Route.NotFound path, _ ) ->
            ( { model | state = Ready sync (NotFoundPage path) }, Effect.none )


queueChanges : List Settings.Change -> Model -> ( Model, Effect Msg )
queueChanges changes model =
    case ( changes, model.state ) of
        ( [], _ ) ->
            unchanged model

        ( _, Ready sync page ) ->
            applySettingsTransition page model (SettingsSync.queue (List.foldl Settings.apply (SettingsSync.value sync) changes) sync)

        ( _, Booting _ ) ->
            unchanged model

        ( _, BootFailed _ _ ) ->
            unchanged model


applySettingsTransition : Page -> Model -> ( SettingsSync.Sync, Maybe SettingsSync.SaveRequest ) -> ( Model, Effect Msg )
applySettingsTransition page model ( sync, request ) =
    ( { model | state = Ready sync page }
    , case request of
        Just save ->
            Api.saveSettings save.settings (SettingsSaved save.revision) (SettingsSaveFailed save.revision)

        Nothing ->
            Effect.none
    )


addEffect : Effect Msg -> ( Model, Effect Msg ) -> ( Model, Effect Msg )
addEffect additional ( model, effect ) =
    ( model, Effect.batch [ effect, additional ] )


view : Model -> Browser.Document Msg
view model =
    { title = documentTitle model
    , body =
        [ div [ classList [ ( "hunker-app", True ), ( "top-bar-hidden", topBar model == Just Collapsed ) ] ]
            [ topBarView model
            , saveFailureBanner model
            , pageView model
            ]
        ]
    }


topBar : Model -> Maybe Visibility
topBar model =
    case model.state of
        Ready sync _ ->
            Just (SettingsSync.value sync).topBar

        Booting _ ->
            Nothing

        BootFailed _ _ ->
            Nothing


documentTitle : Model -> String
documentTitle model =
    case model.state of
        Ready _ (ReviewPage review) ->
            Review.title review

        Ready _ (RepositoryPage repository) ->
            Repository.repositoryName repository ++ " · Hunker"

        Ready _ (SettingsPage _) ->
            "Settings · Hunker"

        Ready _ (HomePage _) ->
            "Local repositories · Hunker"

        Ready _ (NotFoundPage _) ->
            "Not found · Hunker"

        BootFailed _ _ ->
            "Could not start · Hunker"

        Booting _ ->
            "Loading · Hunker"


{-| Settings controls only appear once settings are loaded; before that the
bar offers only navigation.
-}
topBarView : Model -> Html Msg
topBarView model =
    case topBar model of
        Just Collapsed ->
            button
                [ type_ "button"
                , attribute "id" "show-top-bar"
                , class "top-bar-reveal"
                , attribute "aria-label" "Show top bar"
                , attribute "title" "Show top bar"
                , onClick (ChangedTopBar Expanded)
                ]
                [ text "↓" ]

        Just Expanded ->
            appBar model
                [ a [ class "app-bar-button", href "/settings", attribute "aria-label" "Settings", attribute "title" "Settings" ]
                    [ span [ class "app-bar-settings-label" ] [ text "Settings" ]
                    , span [ class "app-bar-settings-icon", attribute "aria-hidden" "true" ] [ text "⚙" ]
                    ]
                , button
                    [ type_ "button"
                    , attribute "id" "hide-top-bar"
                    , class "top-bar-toggle"
                    , attribute "aria-label" "Hide top bar"
                    , attribute "title" "Hide top bar"
                    , onClick (ChangedTopBar Collapsed)
                    ]
                    [ text "↑" ]
                ]

        Nothing ->
            appBar model []


appBar : Model -> List (Html Msg) -> Html Msg
appBar model actions =
    let
        rejection =
            case model.githubInput of
                Editing _ ->
                    Nothing

                Rejected _ error ->
                    Just error
    in
    header [ class "app-bar" ]
        [ a [ class "brand", href "/" ]
            [ span [ class "brand-mark" ] [ text "H" ]
            , span [ class "brand-name" ] [ text "hunker" ]
            ]
        , pageToolbar model
        , form [ class "github-location-form", onSubmit SubmittedGitHubInput ]
            [ input
                [ type_ "text"
                , attribute "aria-label" "GitHub URL"
                , placeholder "Paste any GitHub URL"
                , value (githubDraft model.githubInput)
                , onInput ChangedGitHubInput
                , attribute "aria-invalid"
                    (case rejection of
                        Just _ ->
                            "true"

                        Nothing ->
                            "false"
                    )
                ]
                []
            , button [ type_ "submit" ] [ text "Open" ]
            , case rejection of
                Just error ->
                    span [ class "github-location-error", attribute "role" "alert" ] [ text (githubInputErrorMessage error) ]

                Nothing ->
                    text ""
            ]
        , div [ class "app-bar-actions" ] actions
        ]


githubInputErrorMessage : Route.GithubInputError -> String
githubInputErrorMessage error =
    case error of
        Route.UnparseableUrl ->
            "Paste a complete GitHub repository, pull request, compare, commit, or file URL."

        Route.ForeignHost ->
            "Hunker currently accepts github.com or Hunker URLs."

        Route.UnsupportedLocation ->
            "Hunker does not have a focused view for that GitHub URL."


{-| A failed save from any page is reported once in the app chrome; the
settings page shows its own status beside the form.
-}
saveFailureBanner : Model -> Html Msg
saveFailureBanner model =
    case model.state of
        Ready _ (SettingsPage _) ->
            text ""

        Ready sync _ ->
            case SettingsSync.status sync of
                SettingsSync.SaveFailed error ->
                    div [ class "settings-save-banner", attribute "role" "alert" ]
                        [ span [] [ text ("Could not save settings: " ++ ApiError.message error) ]
                        , button [ type_ "button", onClick RetriedSettingsSave ] [ text "Retry" ]
                        ]

                SettingsSync.Saved _ ->
                    text ""

                SettingsSync.SaveInProgress ->
                    text ""

        Booting _ ->
            text ""

        BootFailed _ _ ->
            text ""


pageToolbar : Model -> Html Msg
pageToolbar model =
    case model.state of
        Ready _ (RepositoryPage repository) ->
            div [ class "repository-toolbar" ]
                (Repository.toolbar repository |> List.map (Html.map RepositoryMsg))

        Ready _ (ReviewPage review) ->
            div [ class "review-app-location" ]
                [ span [] [ text "Review" ]
                , strong [] [ text (Git.repositoryToString (Review.location review).repository) ]
                ]

        _ ->
            span [ class "brand-tagline" ] [ text "review the change, not the noise" ]


pageView : Model -> Html Msg
pageView model =
    case model.state of
        Booting _ ->
            stateView "Starting Hunker…" "Loading server-owned settings before choosing the page state."

        BootFailed _ error ->
            main_ [ class "page-state is-error", attribute "role" "alert" ]
                [ strong [] [ text "Could not load Hunker settings" ]
                , p [] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick RetriedBootstrap ] [ text "Try again" ]
                ]

        Ready sync page ->
            let
                settings =
                    SettingsSync.value sync
            in
            case page of
                HomePage home ->
                    Html.map HomeMsg (Home.view home)

                SettingsPage settingsPage ->
                    Html.map SettingsMsg (SettingsPage.view (SettingsSync.status sync) settings settingsPage)

                RepositoryPage repository ->
                    Html.map RepositoryMsg (Repository.view settings.syntaxHighlighting repository)

                ReviewPage review ->
                    Html.map ReviewMsg (Review.view settings review)

                NotFoundPage path ->
                    main_ [ class "page-state is-error" ]
                        [ strong [] [ text "Hunker does not have a view for this URL" ]
                        , p [] [ text path ]
                        , a [ href "/" ] [ text "Return to repositories" ]
                        ]


stateView : String -> String -> Html msg
stateView heading detail =
    main_ [ class "page-state" ]
        [ span [ class "loading-spinner" ] []
        , strong [] [ text heading ]
        , p [] [ text detail ]
        ]


unchanged : Model -> ( Model, Effect Msg )
unchanged model =
    ( model, Effect.none )
