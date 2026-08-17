module Main exposing (Model, Msg(..), init, main, update, view)

import Browser
import Browser.Navigation as Navigation
import Html exposing (Html, a, button, div, form, header, input, main_, p, span, strong, text)
import Html.Attributes exposing (attribute, class, href, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Settings as Settings exposing (Settings, SettingsDocument)
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


type alias Model =
    { state : AppState
    , githubInput : String
    , githubInputError : String
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
    | ChangedGitHubInput String
    | SubmittedGitHubInput
    | ChangedTopBarCollapsed Bool
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
    let
        route =
            Route.fromUrl url
    in
    ( { state = Booting route
      , githubInput = ""
      , githubInputError = ""
      }
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
        Ready _ page ->
            case page of
                RepositoryPage repository ->
                    Sub.map RepositoryMsg (Repository.subscriptions repository)

                ReviewPage review ->
                    Sub.map ReviewMsg (Review.subscriptions review)

                _ ->
                    Sub.none

        _ ->
            Sub.none


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        LinkClicked request ->
            case request of
                Browser.Internal url ->
                    ( model, Effect.PushUrl (Url.toString url) )

                Browser.External url ->
                    ( model, Effect.LoadExternal url )

        UrlChanged url ->
            let
                route =
                    Route.fromUrl url
            in
            case model.state of
                Ready settingsState (ReviewPage review) ->
                    case route of
                        Route.Review reviewLocation ->
                            let
                                ( updated, effect ) =
                                    Review.navigate reviewLocation review
                            in
                            ( { model | state = Ready settingsState (ReviewPage updated) }
                            , Effect.map ReviewMsg effect
                            )

                        _ ->
                            startRoute settingsState route model

                Ready settingsState (RepositoryPage repository) ->
                    case route of
                        Route.Repository repositoryLocation ->
                            let
                                ( updated, effect ) =
                                    Repository.navigate repositoryLocation repository
                            in
                            ( { model | state = Ready settingsState (RepositoryPage updated) }
                            , Effect.map RepositoryMsg effect
                            )

                        _ ->
                            startRoute settingsState route model

                Ready settingsState _ ->
                    startRoute settingsState route model

                BootFailed _ error ->
                    ( { model | state = BootFailed route error }, Effect.none )

                Booting _ ->
                    ( { model | state = Booting route }, Effect.none )

        SettingsLoaded document ->
            case bootRoute model.state of
                Just route ->
                    startRoute (SettingsSync.loaded document) route model

                Nothing ->
                    unchanged model

        SettingsLoadFailed error ->
            case bootRoute model.state of
                Just route ->
                    ( { model | state = BootFailed route error }, Effect.none )

                Nothing ->
                    unchanged model

        SettingsSaved revision document ->
            finishSettingsSave revision document model

        SettingsSaveFailed revision error ->
            failSettingsSave revision error model

        RetriedBootstrap ->
            case model.state of
                BootFailed route _ ->
                    ( { model | state = Booting route }, Api.loadSettings SettingsLoaded SettingsLoadFailed )

                _ ->
                    unchanged model

        ChangedGitHubInput githubInput ->
            ( { model | githubInput = githubInput, githubInputError = "" }, Effect.none )

        SubmittedGitHubInput ->
            case Route.fromGithubString (String.trim model.githubInput) of
                Ok route ->
                    ( { model | githubInputError = "" }, Effect.PushUrl (Route.toPath route) )

                Err error ->
                    ( { model | githubInputError = error }, Effect.none )

        ChangedTopBarCollapsed collapsed ->
            case model.state of
                Ready sync _ ->
                    let
                        settings =
                            SettingsSync.value sync
                    in
                    queueSettings { settings | topBarCollapsed = collapsed } model
                        |> addEffect
                            (Effect.Focus
                                (if collapsed then
                                    "show-top-bar"

                                 else
                                    "hide-top-bar"
                                )
                                TopBarFocusSettled
                            )

                _ ->
                    unchanged model

        TopBarFocusSettled ->
            unchanged model

        HomeMsg message ->
            updatePage model
                (\settings page ->
                    case page of
                        HomePage home ->
                            Home.update message home
                                |> mapPage HomePage HomeMsg settings model

                        _ ->
                            unchanged model
                )

        SettingsMsg message ->
            updatePage model
                (\settingsState page ->
                    case page of
                        SettingsPage settingsModel ->
                            let
                                ( updated, effect ) =
                                    SettingsPage.update message settingsModel

                                updatedModel =
                                    { model | state = Ready settingsState (SettingsPage updated) }
                            in
                            case SettingsPage.submission message updated of
                                Just desired ->
                                    queueSettings desired updatedModel
                                        |> addEffect (Effect.map SettingsMsg effect)

                                Nothing ->
                                    ( updatedModel, Effect.map SettingsMsg effect )

                        _ ->
                            unchanged model
                )

        RepositoryMsg message ->
            updatePage model
                (\settings page ->
                    case page of
                        RepositoryPage repository ->
                            Repository.update message repository
                                |> mapPage RepositoryPage RepositoryMsg settings model

                        _ ->
                            unchanged model
                )

        ReviewMsg message ->
            updatePage model
                (\settingsState page ->
                    case page of
                        ReviewPage review ->
                            let
                                settings =
                                    SettingsSync.value settingsState

                                intent =
                                    Review.settingsIntent settings message

                                desired =
                                    intent
                                        |> Maybe.withDefault settings

                                ( updated, effect ) =
                                    Review.update desired message review

                                updatedModel =
                                    { model | state = Ready settingsState (ReviewPage updated) }
                            in
                            case intent of
                                Just changed ->
                                    queueSettings changed updatedModel
                                        |> addEffect (Effect.map ReviewMsg effect)

                                Nothing ->
                                    ( updatedModel, Effect.map ReviewMsg effect )

                        _ ->
                            unchanged model
                )


updatePage : Model -> (SettingsSync.Sync -> Page -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
updatePage model apply =
    case model.state of
        Ready settingsState page ->
            apply settingsState page

        _ ->
            unchanged model


mapPage : (childModel -> Page) -> (childMsg -> Msg) -> SettingsSync.Sync -> Model -> ( childModel, Effect childMsg ) -> ( Model, Effect Msg )
mapPage toPage toMsg settingsState model ( childModel, childEffect ) =
    ( { model | state = Ready settingsState (toPage childModel) }
    , Effect.map toMsg childEffect
    )


startRoute : SettingsSync.Sync -> Route -> Model -> ( Model, Effect Msg )
startRoute settingsState route model =
    let
        settings =
            SettingsSync.value settingsState
    in
    case route of
        Route.Home ->
            let
                ( home, effect ) =
                    Home.init
            in
            ( { model | state = Ready settingsState (HomePage home) }
            , Effect.map HomeMsg effect
            )

        Route.Settings ->
            let
                ( settingsModel, effect ) =
                    SettingsPage.init settings
            in
            ( { model | state = Ready settingsState (SettingsPage settingsModel) }
            , Effect.map SettingsMsg effect
            )

        Route.Repository repositoryLocation ->
            let
                ( repository, effect ) =
                    Repository.init repositoryLocation
            in
            ( { model | state = Ready settingsState (RepositoryPage repository) }
            , Effect.map RepositoryMsg effect
            )

        Route.Review reviewLocation ->
            let
                ( review, effect ) =
                    Review.init reviewLocation
            in
            ( { model | state = Ready settingsState (ReviewPage review) }
            , Effect.map ReviewMsg effect
            )

        Route.NotFound path ->
            ( { model | state = Ready settingsState (NotFoundPage path) }, Effect.none )


bootRoute : AppState -> Maybe Route
bootRoute state =
    case state of
        Booting route ->
            Just route

        BootFailed route _ ->
            Just route

        Ready _ _ ->
            Nothing


queueSettings : Settings -> Model -> ( Model, Effect Msg )
queueSettings desired model =
    case model.state of
        Ready sync page ->
            applySettingsTransition page model (SettingsSync.queue desired sync)

        _ ->
            unchanged model


finishSettingsSave : SettingsSync.Revision -> SettingsDocument -> Model -> ( Model, Effect Msg )
finishSettingsSave revision document model =
    case model.state of
        Ready sync page ->
            applySettingsTransition page model (SettingsSync.saved revision document sync)

        _ ->
            unchanged model


failSettingsSave : SettingsSync.Revision -> ApiError -> Model -> ( Model, Effect Msg )
failSettingsSave revision error model =
    case model.state of
        Ready sync page ->
            ( { model | state = Ready (SettingsSync.failed revision error sync) page }, Effect.none )

        _ ->
            unchanged model


applySettingsTransition : Page -> Model -> ( SettingsSync.Sync, Maybe SettingsSync.SaveRequest ) -> ( Model, Effect Msg )
applySettingsTransition page model ( sync, request ) =
    ( { model | state = Ready sync page }
    , request
        |> Maybe.map
            (\save ->
                Api.saveSettings save.settings
                    (SettingsSaved save.revision)
                    (SettingsSaveFailed save.revision)
            )
        |> Maybe.withDefault Effect.none
    )


settingsSaveStatus : SettingsSync.Sync -> SettingsPage.SaveStatus
settingsSaveStatus sync =
    case SettingsSync.status sync of
        SettingsSync.Saved configPath ->
            SettingsPage.SaveSucceeded configPath

        SettingsSync.SaveInProgress ->
            SettingsPage.SaveInProgress

        SettingsSync.SaveFailed error ->
            SettingsPage.SaveError (ApiError.message error)


addEffect : Effect Msg -> ( Model, Effect Msg ) -> ( Model, Effect Msg )
addEffect additional ( model, effect ) =
    ( model, Effect.batch [ effect, additional ] )


view : Model -> Browser.Document Msg
view model =
    { title = documentTitle model
    , body =
        [ div [ class ("hunker-app" ++ topBarClass model) ]
            [ topBar model
            , pageView model
            ]
        ]
    }


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


topBar : Model -> Html Msg
topBar model =
    if topBarIsCollapsed model then
        button
            [ type_ "button"
            , attribute "id" "show-top-bar"
            , class "top-bar-reveal"
            , attribute "aria-label" "Show top bar"
            , attribute "title" "Show top bar"
            , onClick (ChangedTopBarCollapsed False)
            ]
            [ text "↓" ]

    else
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
                    , value model.githubInput
                    , onInput ChangedGitHubInput
                    , attribute "aria-invalid"
                        (if model.githubInputError == "" then
                            "false"

                         else
                            "true"
                        )
                    ]
                    []
                , button [ type_ "submit" ] [ text "Open" ]
                , if model.githubInputError == "" then
                    text ""

                  else
                    span [ class "github-location-error", attribute "role" "alert" ] [ text model.githubInputError ]
                ]
            , div [ class "app-bar-actions" ]
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
                    , onClick (ChangedTopBarCollapsed True)
                    ]
                    [ text "↑" ]
                ]
            ]


topBarIsCollapsed : Model -> Bool
topBarIsCollapsed model =
    case model.state of
        Ready sync _ ->
            (SettingsSync.value sync).topBarCollapsed

        _ ->
            False


topBarClass : Model -> String
topBarClass model =
    if topBarIsCollapsed model then
        " top-bar-hidden"

    else
        ""


pageToolbar : Model -> Html Msg
pageToolbar model =
    case model.state of
        Ready _ (RepositoryPage repository) ->
            div [ class "repository-toolbar" ]
                (Repository.toolbar repository |> List.map (Html.map RepositoryMsg))

        Ready _ (ReviewPage review) ->
            div [ class "review-app-location" ]
                [ span [] [ text "Review" ]
                , strong [] [ text (Route.repositoryName (Review.location review).target) ]
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
                , button [ type_ "button", Html.Events.onClick RetriedBootstrap ] [ text "Try again" ]
                ]

        Ready settingsState page ->
            let
                settings =
                    SettingsSync.value settingsState
            in
            case page of
                HomePage home ->
                    Html.map HomeMsg (Home.view home)

                SettingsPage settingsModel ->
                    Html.map SettingsMsg (SettingsPage.view (settingsSaveStatus settingsState) settingsModel)

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
